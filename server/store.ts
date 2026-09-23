/**
 * SQLite persistence. One row per tournament plus the applied-command log
 * that makes pushes idempotent (see docs/SYNC.md). All mutating operations
 * that need to be atomic go through `transaction()`; `node:sqlite` has no
 * built-in transaction helper, so it is hand-rolled with BEGIN/COMMIT/ROLLBACK.
 */
import type { TournamentSnapshot } from '../src/sync/protocol';
import { openDatabase, type SqliteDatabase } from './sqlite';

export interface StoredTournament {
  id: string;
  revision: number;
  snapshot: TournamentSnapshot | null;
  passwordHash: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tournaments (
    id            TEXT PRIMARY KEY,
    revision      INTEGER NOT NULL,
    snapshot      TEXT,
    password_hash TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    deleted_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS applied_commands (
    seq           INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id TEXT NOT NULL,
    command_id    TEXT NOT NULL,
    revision      INTEGER NOT NULL,
    UNIQUE (tournament_id, command_id)
  );

  CREATE INDEX IF NOT EXISTS idx_applied_commands_tournament
    ON applied_commands (tournament_id, seq);

  CREATE INDEX IF NOT EXISTS idx_tournaments_updated_at
    ON tournaments (updated_at);

  CREATE INDEX IF NOT EXISTS idx_tournaments_deleted_at
    ON tournaments (deleted_at);
`;

/** Rows beyond this many per tournament are pruned after every push. */
const APPLIED_COMMANDS_KEEP = 500;

function toRow(record: Record<string, unknown>): StoredTournament {
  return {
    id: record.id as string,
    revision: Number(record.revision),
    snapshot: record.snapshot ? (JSON.parse(record.snapshot as string) as TournamentSnapshot) : null,
    passwordHash: (record.password_hash as string | null) ?? null,
    createdAt: Number(record.created_at),
    updatedAt: Number(record.updated_at),
    deletedAt: record.deleted_at === null || record.deleted_at === undefined ? null : Number(record.deleted_at),
  };
}

export class Store {
  private readonly db: SqliteDatabase;

  constructor(path: string) {
    this.db = openDatabase(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Runs `fn` inside a SQLite transaction. `node:sqlite` executes
   * synchronously, so this is a plain synchronous wrapper - no interleaving
   * with another request is possible while it runs.
   */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Any row with this id, tombstoned or not - used for the "exists" check on create. */
  exists(id: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM tournaments WHERE id = ?').get(id);
    return row !== undefined;
  }

  get(id: string): StoredTournament | undefined {
    const row = this.db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
    return row ? toRow(row) : undefined;
  }

  insert(
    id: string,
    snapshot: TournamentSnapshot,
    passwordHash: string | null,
    now: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO tournaments (id, revision, snapshot, password_hash, created_at, updated_at, deleted_at)
         VALUES (?, 1, ?, ?, ?, ?, NULL)`,
      )
      .run(id, JSON.stringify(snapshot), passwordHash, now, now);
  }

  /** Stores a new snapshot at revision+1. Caller has already checked baseRevision under the lock. */
  push(id: string, snapshot: TournamentSnapshot, commandIds: string[], now: number): number {
    const current = this.get(id);
    if (!current) throw new Error(`push: unknown tournament ${id}`);
    const revision = current.revision + 1;
    this.db
      .prepare(`UPDATE tournaments SET revision = ?, snapshot = ?, updated_at = ? WHERE id = ?`)
      .run(revision, JSON.stringify(snapshot), now, id);
    const insertCommand = this.db.prepare(
      `INSERT OR IGNORE INTO applied_commands (tournament_id, command_id, revision) VALUES (?, ?, ?)`,
    );
    for (const commandId of commandIds) insertCommand.run(id, commandId, revision);
    this.pruneAppliedCommands(id);
    return revision;
  }

  /** Which of `commandIds` this tournament has already recorded as applied. */
  appliedOf(id: string, commandIds: string[]): string[] {
    if (commandIds.length === 0) return [];
    const placeholders = commandIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT command_id FROM applied_commands WHERE tournament_id = ? AND command_id IN (${placeholders})`,
      )
      .all(id, ...commandIds);
    return rows.map((row) => row.command_id as string);
  }

  private pruneAppliedCommands(id: string): void {
    this.db
      .prepare(
        `DELETE FROM applied_commands
         WHERE tournament_id = ?
           AND seq NOT IN (
             SELECT seq FROM applied_commands WHERE tournament_id = ? ORDER BY seq DESC LIMIT ?
           )`,
      )
      .run(id, id, APPLIED_COMMANDS_KEEP);
  }

  setPasswordHash(id: string, hash: string | null, now: number): void {
    this.db.prepare(`UPDATE tournaments SET password_hash = ?, updated_at = ? WHERE id = ?`).run(hash, now, id);
  }

  /** Tombstones the row: the id stays reserved (still 409 on create) but the snapshot is gone. */
  tombstone(id: string, now: number): void {
    this.db
      .prepare(`UPDATE tournaments SET snapshot = NULL, password_hash = NULL, updated_at = ?, deleted_at = ? WHERE id = ?`)
      .run(now, now, id);
    this.db.prepare(`DELETE FROM applied_commands WHERE tournament_id = ?`).run(id);
  }

  /** Tombstones every live tournament untouched since `cutoff`. Returns their ids. */
  tombstoneStale(cutoff: number, now: number): string[] {
    const rows = this.db
      .prepare(`SELECT id FROM tournaments WHERE deleted_at IS NULL AND updated_at < ?`)
      .all(cutoff);
    const ids = rows.map((row) => row.id as string);
    for (const id of ids) this.tombstone(id, now);
    return ids;
  }

  /** Permanently removes tombstones older than `cutoff`, freeing their ids for reuse. */
  purgeTombstones(cutoff: number): number {
    const rows = this.db.prepare(`SELECT id FROM tournaments WHERE deleted_at IS NOT NULL AND deleted_at < ?`).all(cutoff);
    const stmt = this.db.prepare(`DELETE FROM tournaments WHERE id = ?`);
    const clearCommands = this.db.prepare(`DELETE FROM applied_commands WHERE tournament_id = ?`);
    for (const row of rows) {
      stmt.run(row.id);
      clearCommands.run(row.id);
    }
    return rows.length;
  }
}
