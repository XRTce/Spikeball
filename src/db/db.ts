import Dexie, { type Table } from 'dexie';
import type { Match, Player, Tournament } from '../domain/types';
import type { CommandName, SyncErrorCode } from '../sync/protocol';

export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * A mutation that ran against the local copy of a public tournament but has
 * not been accepted by the server yet. Kept so it can be replayed on top of a
 * newer server state when someone else changed the tournament in between.
 */
export interface PendingCommand {
  /** Random id; the server remembers applied ids so a retried push is not applied twice. */
  id: string;
  name: CommandName;
  /** The repo function's arguments, exactly as passed. JSON-serialisable. */
  args: unknown[];
  /**
   * Every id `makeId()` handed out while the command ran the first time, in
   * order. A replay feeds them back so a match created offline keeps its id
   * and a later command that references it still finds it.
   */
  ids: string[];
  createdAt: number;
}

/**
 * Device-local bookkeeping for a public tournament. Never uploaded: the
 * tournament, players and matches tables hold the shared data, this row holds
 * what only this device knows about its relationship to the server.
 */
export interface SyncRow {
  tournamentId: string;
  /** How this device got the tournament: created it here, or opened a link. */
  role: 'owner' | 'joined';
  /** Server revision the local copy is based on. 0 = not uploaded yet. */
  revision: number;
  /** Local mutations not yet accepted by the server, oldest first. */
  pending: PendingCommand[];
  /** Whether the server has an admin password for this tournament. */
  protected: boolean;
  /**
   * Admin password remembered after creating or unlocking on this device.
   * Stored in plain text on purpose: it guards against a friend's slip of the
   * thumb, not against someone holding this unlocked phone.
   */
  adminPassword: string | null;
  lastSyncedAt: number | null;
  /** Why the last sync attempt failed, if it did. Cleared on success. */
  error: SyncErrorCode | null;
}

/**
 * Tournaments live in IndexedDB on each device. Local tournaments never leave
 * it; public ones are additionally mirrored on the sync server (see
 * docs/SYNC.md), but the UI still only ever reads from IndexedDB.
 *
 * Ratings are never stored incrementally - `players.elo` is a denormalised
 * copy of the last replay so lists render without loading the whole match log.
 * The authoritative state is always (players.baseElo, matches).
 */
export class RallyDatabase extends Dexie {
  tournaments!: Table<Tournament, string>;
  players!: Table<Player, string>;
  matches!: Table<Match, string>;
  meta!: Table<MetaRow, string>;
  sync!: Table<SyncRow, string>;

  constructor(name = 'rally') {
    super(name);
    this.version(1).stores({
      tournaments: 'id, createdAt, updatedAt, status',
      players: 'id, tournamentId, [tournamentId+active], [tournamentId+inTournament], name',
      matches:
        'id, tournamentId, sequence, [tournamentId+stage], [tournamentId+status], [tournamentId+round]',
      meta: 'key',
    });
    this.version(2)
      .stores({ sync: 'tournamentId' })
      .upgrade((tx) =>
        // Everything created before sync existed is, by definition, local.
        tx
          .table('tournaments')
          .toCollection()
          .modify((tournament: Partial<Tournament>) => {
            if (!tournament.visibility) tournament.visibility = 'local';
          }),
      );
  }
}

export const db = new RallyDatabase();

/** RFC 4122 v4 id, with a fallback for browsers without randomUUID. */
function randomId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (globalCrypto && typeof globalCrypto.getRandomValues === 'function') {
    globalCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * `makeId()` normally just hands out a fresh random id. While a public-
 * tournament command runs, `withIdTape` switches it to one of two modes so
 * the sync engine can replay a command deterministically (docs/SYNC.md,
 * "Replay"):
 *
 * - `record`: every id handed out is remembered, in call order.
 * - `replay`: ids are played back from a previous recording instead of being
 *   randomly generated, so a match created offline keeps the same id when the
 *   command runs again on top of a newer server snapshot. Once the recording
 *   is exhausted (the command now creates something it didn't before) it
 *   falls back to random ids.
 *
 * This is a plain module-level variable, not something scoped per call: it is
 * safe only because commands on a public tournament are run one at a time
 * through a single global queue (src/sync/commands.ts), so tapes never
 * interleave. `recalculate()` and other nested helpers a command calls share
 * the same tape, which is what makes replay deterministic for them too.
 */
type IdTape =
  | { kind: 'record'; ids: string[] }
  | { kind: 'replay'; ids: string[]; index: number };

let activeTape: IdTape | null = null;

export function makeId(): string {
  if (activeTape) {
    if (activeTape.kind === 'replay') {
      if (activeTape.index < activeTape.ids.length) {
        return activeTape.ids[activeTape.index++]!;
      }
      // Recording ran out: this run of the command creates more things than
      // the original did. Fall back to fresh ids for the rest.
    } else {
      const id = randomId();
      activeTape.ids.push(id);
      return id;
    }
  }
  return randomId();
}

export type IdTapeMode = { mode: 'record' } | { mode: 'replay'; ids: string[] };

/**
 * Runs `fn` with `makeId()` switched to record or replay mode, and returns
 * both its result and the ids that were recorded (in record mode) or
 * consumed from the recording (in replay mode, capped to what was actually
 * used).
 */
export async function withIdTape<T>(
  tape: IdTapeMode,
  fn: () => Promise<T>,
): Promise<{ result: T; ids: string[] }> {
  const previous = activeTape;
  const next: IdTape =
    tape.mode === 'record' ? { kind: 'record', ids: [] } : { kind: 'replay', ids: tape.ids, index: 0 };
  activeTape = next;
  try {
    const result = await fn();
    const ids = next.kind === 'record' ? next.ids : next.ids.slice(0, next.index);
    return { result, ids };
  } finally {
    activeTape = previous;
  }
}

export type StorageMode = 'persistent' | 'best-effort' | 'unsupported';

export interface StorageStatus {
  mode: StorageMode;
  usageBytes: number | null;
  quotaBytes: number | null;
}

/**
 * Asks the browser to make this origin's storage persistent, which stops the
 * data from being evicted when the device runs low on space. Installed PWAs
 * are usually granted this without a prompt.
 */
export async function requestPersistentStorage(): Promise<StorageStatus> {
  const storage = navigator.storage;
  if (!storage || typeof storage.persisted !== 'function') {
    return { mode: 'unsupported', usageBytes: null, quotaBytes: null };
  }

  let persisted = await storage.persisted();
  if (!persisted && typeof storage.persist === 'function') {
    try {
      persisted = await storage.persist();
    } catch {
      persisted = false;
    }
  }

  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  if (typeof storage.estimate === 'function') {
    try {
      const estimate = await storage.estimate();
      usageBytes = estimate.usage ?? null;
      quotaBytes = estimate.quota ?? null;
    } catch {
      /* estimate is optional */
    }
  }

  return { mode: persisted ? 'persistent' : 'best-effort', usageBytes, quotaBytes };
}
