/**
 * Wraps a src/db/repo.ts mutation so that, on a public tournament, it runs as
 * a recorded, replayable command (docs/SYNC.md, "Commands"). The exported
 * function keeps its name and signature; repo.ts calls `command(...)` once
 * per mutation and exports the wrapped result.
 */
import { db, makeId, withIdTape, type PendingCommand } from '../db/db';
import type { CommandName } from './protocol';
import { protectedChanges } from './protection';
import { readProtectionSnapshot } from './snapshot';
import { SyncError } from './errors';
// Circular with engine.ts by design: engine.ts looks commands back up by
// name for replay, commands.ts triggers a sync once one is queued. Neither
// side calls the other at module-eval time, only from inside async
// functions, so the cycle is harmless under ESM's live bindings.
import { scheduleSync } from './engine';

type AnyFn = (...args: any[]) => Promise<any>;

/**
 * name -> the original, unwrapped implementation. The replay step in
 * engine.ts looks a command back up here to run it again by name.
 */
const registry = new Map<CommandName, AnyFn>();

export function getCommandImpl(name: CommandName): AnyFn | undefined {
  return registry.get(name);
}

/**
 * Public commands run one at a time, so that id recording is unambiguous and
 * a replay never interleaves with a new tap (docs/SYNC.md, "Commands").
 * Local-tournament calls bypass this queue entirely - only a mutation that
 * actually touches a public tournament pays for serialisation.
 */
let queueTail: Promise<unknown> = Promise.resolve();

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const result = queueTail.then(run, run);
  // Swallow the outcome for chaining purposes only: a failed command must not
  // stall every command after it.
  queueTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Registers `impl` under `name` for replay, and returns a function with the
 * same signature that:
 *  - runs `impl` unchanged for a local tournament (or when the id cannot be
 *    resolved, e.g. the target was already deleted - `impl` itself is
 *    responsible for no-op-ing on a missing row, exactly as before);
 *  - for a public tournament, runs `impl` inside one transaction, records
 *    every id it hands out, diffs the tournament before and after with
 *    protectedChanges(), and either throws SyncError('locked', reasons) (the
 *    transaction rolls back, nothing is written) or appends the command to
 *    sync.pending and schedules a sync.
 */
export function command<F extends AnyFn>(
  name: CommandName,
  tournamentIdOf: (...args: Parameters<F>) => string | null | Promise<string | null>,
  impl: F,
): F {
  registry.set(name, impl);

  const wrapped = async (...args: Parameters<F>): Promise<Awaited<ReturnType<F>>> => {
    const tournamentId = await tournamentIdOf(...args);
    if (!tournamentId) return impl(...args);

    const tournament = await db.tournaments.get(tournamentId);
    if (!tournament || tournament.visibility === 'local') return impl(...args);

    return enqueue(() => runPublicCommand(name, tournamentId, impl, args));
  };

  return wrapped as F;
}

async function runPublicCommand<F extends AnyFn>(
  name: CommandName,
  tournamentId: string,
  impl: F,
  args: Parameters<F>,
): Promise<Awaited<ReturnType<F>>> {
  let capturedResult!: Awaited<ReturnType<F>>;

  await db.transaction('rw', db.tournaments, db.players, db.matches, db.sync, async () => {
    const sync = await db.sync.get(tournamentId);
    const before = await readProtectionSnapshot(tournamentId);

    const { result, ids } = await withIdTape({ mode: 'record' }, () => impl(...args));

    const after = await readProtectionSnapshot(tournamentId);
    const reasons = protectedChanges(before, after);
    if (reasons.length > 0 && sync?.protected && sync.adminPassword == null) {
      throw new SyncError('locked', reasons);
    }

    if (sync) {
      const pending: PendingCommand = {
        id: makeId(),
        name,
        args: structuredClone(args),
        ids,
        createdAt: Date.now(),
      };
      await db.sync.update(tournamentId, { pending: [...sync.pending, pending] });
    }

    capturedResult = result as Awaited<ReturnType<F>>;
  });

  scheduleSync(tournamentId);
  return capturedResult;
}
