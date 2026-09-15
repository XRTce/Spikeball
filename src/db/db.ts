import Dexie, { type Table } from 'dexie';
import type { Match, Player, Tournament } from '../domain/types';

export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * All data lives in IndexedDB on the tournament master's device. There is no
 * account and no server: the app is a local database with a UI on top.
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

  constructor(name = 'rally') {
    super(name);
    this.version(1).stores({
      tournaments: 'id, createdAt, updatedAt, status',
      players: 'id, tournamentId, [tournamentId+active], [tournamentId+inTournament], name',
      matches:
        'id, tournamentId, sequence, [tournamentId+stage], [tournamentId+status], [tournamentId+round]',
      meta: 'key',
    });
  }
}

export const db = new RallyDatabase();

/** RFC 4122 v4 id, with a fallback for browsers without randomUUID. */
export function makeId(): string {
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
