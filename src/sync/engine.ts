/**
 * The sync loop, exactly as documented in docs/SYNC.md ("Sync loop" and
 * "Replay"). One tournament at a time, never two loops for the same
 * tournament concurrently, with 2s-60s backoff on failure.
 */
import { db, withIdTape, type PendingCommand, type SyncRow } from '../db/db';
import type { StateEvent } from './protocol';
import { SyncError } from './errors';
import { getSyncEnv } from './config';
import * as api from './api';
import { commandTarget, getCommandImpl } from './commands';
import { readSyncAndSnapshot, writeSnapshotRows } from './snapshot';
import { emitNotice, setSyncing } from './store';

/* ------------------------------------------------------------------------ */
/* Scheduling: one loop per tournament, merged triggers, backoff             */
/* ------------------------------------------------------------------------ */

/**
 * The running loop for a tournament, if any. A second trigger while one is
 * already running does not start a second loop (never two loops for one
 * tournament); it merges into `pendingOpts` and awaits the *same* promise,
 * which only settles once the loop finds no more requested work.
 */
const activeLoop = new Map<string, Promise<void>>();
const pendingOpts = new Map<string, { pull?: boolean }>();
const backoffDelay = new Map<string, number>();
const retryTimer = new Map<string, unknown>();

function clearRetryTimer(tournamentId: string): void {
  const handle = retryTimer.get(tournamentId);
  if (handle !== undefined) {
    getSyncEnv().clearTimeout(handle);
    retryTimer.delete(tournamentId);
  }
}

function clearBackoff(tournamentId: string): void {
  backoffDelay.delete(tournamentId);
  clearRetryTimer(tournamentId);
}

function scheduleBackoffRetry(tournamentId: string): void {
  const previous = backoffDelay.get(tournamentId) ?? 1000;
  const next = Math.min(previous * 2, 60_000);
  backoffDelay.set(tournamentId, next);
  clearRetryTimer(tournamentId);
  const handle = getSyncEnv().setTimeout(() => scheduleSync(tournamentId), next);
  retryTimer.set(tournamentId, handle);
}

function trigger(tournamentId: string, opts: { pull?: boolean }): Promise<void> {
  const merged = { pull: (pendingOpts.get(tournamentId)?.pull ?? false) || (opts.pull ?? false) };
  pendingOpts.set(tournamentId, merged);

  const existing = activeLoop.get(tournamentId);
  if (existing) return existing; // the running loop re-checks pendingOpts before it exits.

  const promise = loop(tournamentId);
  activeLoop.set(tournamentId, promise);
  return promise;
}

/**
 * Triggers a sync attempt for one tournament. Fire-and-forget: callers that
 * need to know the outcome use syncNow(), which awaits the same loop. Safe to
 * call for a local tournament or one with no sync row - it just no-ops.
 */
export function scheduleSync(tournamentId: string, opts: { pull?: boolean } = {}): void {
  void trigger(tournamentId, opts);
}

/** Same as scheduleSync, but the caller can await the attempt and never sees it throw. */
export async function runSyncNow(tournamentId: string): Promise<void> {
  await trigger(tournamentId, { pull: true });
}

async function loop(tournamentId: string): Promise<void> {
  setSyncing(tournamentId, true);
  try {
    for (;;) {
      const opts = pendingOpts.get(tournamentId) ?? {};
      pendingOpts.delete(tournamentId);
      try {
        await syncStep(tournamentId, opts);
        clearBackoff(tournamentId);
      } catch (err) {
        await recordSyncError(tournamentId, err);
        // A failure leaves the backoff timer (or the next explicit trigger)
        // as the only way to retry - looping immediately here would ignore
        // backoff entirely while commands keep being queued offline.
        return;
      }
      if (!pendingOpts.has(tournamentId)) return;
    }
  } finally {
    activeLoop.delete(tournamentId);
    setSyncing(tournamentId, false);
  }
}

/* ------------------------------------------------------------------------ */
/* One pass of the loop in docs/SYNC.md                                      */
/* ------------------------------------------------------------------------ */

async function syncStep(tournamentId: string, opts: { pull?: boolean }): Promise<void> {
  // A conflict loops back to the top (replay, then push again); everything
  // else does at most one network round-trip per call.
  for (let guard = 0; guard < 25; guard += 1) {
    const sync = await db.sync.get(tournamentId);
    if (!sync) return;

    if (sync.revision === 0) {
      if ((await tryCreate(tournamentId, sync)) === 'retry') continue;
      return;
    }

    if (sync.pending.length > 0) {
      if ((await tryPush(tournamentId, sync)) === 'retry') continue;
      return;
    }

    if (opts.pull) await tryPull(tournamentId, sync);
    return;
  }
}

async function recordSyncError(tournamentId: string, err: unknown): Promise<void> {
  if (err instanceof SyncError && err.code === 'deleted') {
    await convertToLocal(tournamentId);
    emitNotice({ kind: 'deleted', tournamentId });
    return;
  }
  const code = err instanceof SyncError ? (err.code === 'wrong_password' ? 'rejected' : err.code) : 'unknown';
  const row = await db.sync.get(tournamentId);
  // The row can vanish while the request was in flight (left or deleted
  // everywhere meanwhile); forceCloseLiveSync already ran for it, so arming a
  // retry here would resurrect a timer nothing will ever cancel.
  if (!row) return;
  await db.sync.update(tournamentId, { error: code });
  scheduleBackoffRetry(tournamentId);
}

async function convertToLocal(tournamentId: string): Promise<void> {
  await db.transaction('rw', db.tournaments, db.sync, async () => {
    await db.tournaments.update(tournamentId, { visibility: 'local' });
    await db.sync.delete(tournamentId);
  });
  // The sync row is gone, so a backoff timer from an earlier failed attempt
  // would only fire into a no-op, and an EventSource still attached (when the
  // deletion surfaced via push/pull rather than the SSE 'deleted' event, which
  // closes its own) would keep a connection open for a tournament nobody syncs.
  forceCloseLiveSync(tournamentId);
}

/* ------------------------------------------------------------------------ */
/* Create (revision 0)                                                       */
/* ------------------------------------------------------------------------ */

async function tryCreate(tournamentId: string, sync: SyncRow): Promise<'retry' | 'done'> {
  const read = await readSyncAndSnapshot(tournamentId);
  if (!read) return 'done';

  const result = await api.createTournament(read.snapshot, sync.adminPassword);
  if (result.kind === 'created') {
    await db.sync.update(tournamentId, { revision: result.revision, lastSyncedAt: Date.now(), error: null });
    return 'retry'; // loop again: pending commands, if any, still need pushing.
  }

  // A previous create's response was lost. If the server holds our own
  // create (same createdAt), adopt its revision and reconcile like a
  // conflict; a different tournament under the same id is a hard failure.
  const fetched = await api.fetchTournament(tournamentId);
  if (fetched.snapshot.tournament.createdAt === read.snapshot.tournament.createdAt) {
    await replay(tournamentId, []);
    return 'retry';
  }
  throw new SyncError('rejected', [], 'Ein anderes Turnier belegt bereits diese Id');
}

/* ------------------------------------------------------------------------ */
/* Push (pending commands)                                                   */
/* ------------------------------------------------------------------------ */

async function tryPush(tournamentId: string, sync: SyncRow): Promise<'retry' | 'done'> {
  const read = await readSyncAndSnapshot(tournamentId);
  if (!read) return 'done';
  const commandIds = read.sync.pending.map((cmd) => cmd.id);
  if (commandIds.length === 0) return 'done';

  const result = await api.pushTournament(
    tournamentId,
    { baseRevision: read.sync.revision, commandIds, snapshot: read.snapshot },
    sync.adminPassword,
  );

  if (result.kind === 'ok') {
    await db.transaction('rw', db.sync, async () => {
      const current = await db.sync.get(tournamentId);
      if (!current) return;
      const pushed = new Set(commandIds);
      // Commands queued while the request was in flight are not in `pushed`
      // and stay pending for the next round.
      const stillPending = current.pending.filter((cmd) => !pushed.has(cmd.id));
      await db.sync.update(tournamentId, {
        revision: result.revision,
        pending: stillPending,
        lastSyncedAt: Date.now(),
        error: null,
      });
    });
    return 'retry'; // more may have queued up in the meantime.
  }

  if (result.kind === 'conflict') {
    await replay(tournamentId, result.applied);
    return 'retry';
  }

  // locked
  const row = await db.sync.get(tournamentId);
  if (row) await db.sync.update(tournamentId, { error: 'locked' });
  emitNotice({ kind: 'locked', tournamentId, reasons: result.reasons });
  return 'done';
}

/* ------------------------------------------------------------------------ */
/* Replay (docs/SYNC.md "Replay")                                            */
/* ------------------------------------------------------------------------ */

async function replay(tournamentId: string, applied: string[]): Promise<void> {
  const fetched = await api.fetchTournament(tournamentId);
  const appliedIds = new Set(applied);
  let droppedCount = 0;

  await db.transaction('rw', db.tournaments, db.players, db.matches, db.sync, async () => {
    const sync = await db.sync.get(tournamentId);
    if (!sync) return;

    // A previous push whose response was lost is recognised here and its
    // commands are dropped without being replayed - they are already in the
    // snapshot we are about to install.
    const remaining = sync.pending.filter((cmd) => !appliedIds.has(cmd.id));

    await writeSnapshotRows(fetched.snapshot);

    const surviving: PendingCommand[] = [];
    for (const cmd of remaining) {
      const impl = getCommandImpl(cmd.name);
      if (!impl) {
        droppedCount += 1;
        continue;
      }

      const target = commandTarget(cmd.name, cmd.args);
      if (target) {
        const row = target.table === 'matches' ? await db.matches.get(target.id) : await db.players.get(target.id);
        if (!row) {
          droppedCount += 1; // its target is gone in the newer snapshot.
          continue;
        }
      }

      try {
        await withIdTape({ mode: 'replay', ids: cmd.ids }, () => impl(...cmd.args));
        surviving.push(cmd);
      } catch {
        droppedCount += 1;
      }
    }

    await db.sync.update(tournamentId, {
      revision: fetched.revision,
      protected: fetched.protected,
      pending: surviving,
    });
  });

  if (droppedCount > 0) emitNotice({ kind: 'dropped', tournamentId, count: droppedCount });
}

/* ------------------------------------------------------------------------ */
/* Pull (someone else changed it, no local pending)                          */
/* ------------------------------------------------------------------------ */

async function tryPull(tournamentId: string, sync: SyncRow): Promise<void> {
  const fetched = await api.fetchTournament(tournamentId);
  if (fetched.revision <= sync.revision) return;

  await db.transaction('rw', db.tournaments, db.players, db.matches, db.sync, async () => {
    const current = await db.sync.get(tournamentId);
    if (!current) return;
    await writeSnapshotRows(fetched.snapshot);
    await db.sync.update(tournamentId, {
      revision: fetched.revision,
      protected: fetched.protected,
      lastSyncedAt: Date.now(),
      error: null,
    });
  });
}

/* ------------------------------------------------------------------------ */
/* Live updates (SSE) and boot                                               */
/* ------------------------------------------------------------------------ */

const liveRefCounts = new Map<string, number>();
const liveSources = new Map<string, EventSource>();

async function handleStateEvent(tournamentId: string, data: StateEvent): Promise<void> {
  const sync = await db.sync.get(tournamentId);
  if (!sync) return;
  if (data.revision > sync.revision || data.protected !== sync.protected) {
    scheduleSync(tournamentId, { pull: true });
  }
}

function openLiveSource(tournamentId: string): void {
  const env = getSyncEnv();
  const EventSourceCtor = env.EventSource;
  if (!EventSourceCtor) return;
  const source = new EventSourceCtor(api.eventsUrl(tournamentId));
  source.addEventListener('state', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as StateEvent;
      void handleStateEvent(tournamentId, data);
    } catch {
      /* malformed event; the next one will still carry the current state */
    }
  });
  source.addEventListener('deleted', () => {
    void recordSyncError(tournamentId, new SyncError('deleted'));
    source.close();
  });
  liveSources.set(tournamentId, source);
}

function closeLiveSource(tournamentId: string): void {
  liveSources.get(tournamentId)?.close();
  liveSources.delete(tournamentId);
}

/** Ref-counted: only the first mount opens a connection, only the last unmount closes it. */
export function attachLiveSync(tournamentId: string): void {
  const count = (liveRefCounts.get(tournamentId) ?? 0) + 1;
  liveRefCounts.set(tournamentId, count);
  if (count === 1) openLiveSource(tournamentId);
}

export function detachLiveSync(tournamentId: string): void {
  const count = (liveRefCounts.get(tournamentId) ?? 1) - 1;
  if (count <= 0) {
    liveRefCounts.delete(tournamentId);
    closeLiveSource(tournamentId);
  } else {
    liveRefCounts.set(tournamentId, count);
  }
}

/**
 * Called when a tournament's sync row is gone for good (leave, delete-
 * everywhere, or a remote deletion converting it back to local): drops every
 * trace the engine keeps for it, not just the live connection, so a pending
 * backoff retry cannot linger after nothing will ever look at that id again.
 */
export function forceCloseLiveSync(tournamentId: string): void {
  liveRefCounts.delete(tournamentId);
  closeLiveSource(tournamentId);
  clearBackoff(tournamentId);
  pendingOpts.delete(tournamentId);
}

let started = false;

/**
 * Starts background sync once at app start: flushes every public tournament
 * that has pending changes or was never uploaded, and pulls the others once
 * (to pick up changes made elsewhere while this device was closed - after
 * that, useLiveSync's SSE connection keeps an open tournament current).
 * Also flushes on `online` and on the tab becoming visible again.
 */
export function startSyncEngine(): void {
  if (started) return;
  started = true;

  void bootFlush();

  const env = getSyncEnv();
  env.addWindowListener('online', () => {
    void flushAllPending();
  });
  env.addDocumentListener('visibilitychange', () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') void flushAllPending();
  });
}

async function bootFlush(): Promise<void> {
  const rows = await db.sync.toArray();
  for (const row of rows) {
    if (row.revision === 0 || row.pending.length > 0) scheduleSync(row.tournamentId);
    else scheduleSync(row.tournamentId, { pull: true });
  }
}

async function flushAllPending(): Promise<void> {
  const rows = await db.sync.toArray();
  for (const row of rows) {
    if (row.revision === 0 || row.pending.length > 0) scheduleSync(row.tournamentId);
  }
}

/** Test-only: drops all engine-internal scheduling state between tests. */
export function resetSyncEngine(): void {
  for (const tournamentId of [...liveSources.keys()]) closeLiveSource(tournamentId);
  liveRefCounts.clear();
  activeLoop.clear();
  pendingOpts.clear();
  backoffDelay.clear();
  for (const tournamentId of [...retryTimer.keys()]) clearRetryTimer(tournamentId);
  started = false;
}
