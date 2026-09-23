/**
 * Public API of the sync layer. Screens and components import from here and
 * nowhere else in src/sync.
 */
import { db, type SyncRow } from '../db/db';
import { SyncError } from './errors';
import * as api from './api';
import { readSyncAndSnapshot, writeSnapshotRows } from './snapshot';
import { scheduleSync, runSyncNow, startSyncEngine as startEngine, forceCloseLiveSync } from './engine';
import { onSyncNotice as subscribeNotice, type SyncNotice } from './store';

export type { ProtectedReason, SyncErrorCode } from './protocol';
export { SyncError, isLockedError } from './errors';
export type { SyncNotice } from './store';
export type { SyncState, SyncStatus } from './hooks';
export { useSyncStatus, useServerAvailable, useLiveSync } from './hooks';
export { configureSync, resetSyncEnv, type SyncEnv } from './config';

/** Subscribes to notices; returns the unsubscribe function. */
export function onSyncNotice(listener: (notice: SyncNotice) => void): () => void {
  return subscribeNotice(listener);
}

/**
 * Starts background sync once at app start. It flushes queued changes on
 * `online`, on returning to the tab, and on a timer while anything is
 * pending.
 */
export function startSyncEngine(): void {
  startEngine();
}

/** Pushes queued changes and pulls the latest revision now. Never throws; see useSyncStatus. */
export async function syncNow(tournamentId: string): Promise<void> {
  await runSyncNow(tournamentId);
}

/* ------------------------------------------------------------------------ */
/* Sharing                                                                    */
/* ------------------------------------------------------------------------ */

/** Absolute link that opens the tournament in the app, for the QR code and the share sheet. */
export function shareUrl(tournamentId: string): string {
  return new URL(`t/${tournamentId}`, `${location.origin}${import.meta.env.BASE_URL}`).toString();
}

/**
 * Extracts a tournament id from whatever the user pasted: a full share link
 * (from any host), a path, or the bare id. null if nothing looks like one.
 */
export function parseJoinInput(input: string): string | null {
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(input);
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * Makes a local tournament public: marks it, remembers the password on this
 * device (role 'owner'), and uploads it. It also works offline: the upload is
 * then queued and the status shows `uploaded: false` until it goes through.
 * The password is optional; null means anyone with the link may do anything.
 */
export async function publishTournament(tournamentId: string, password: string | null): Promise<void> {
  const tournament = await db.tournaments.get(tournamentId);
  if (!tournament) throw new SyncError('rejected', [], 'Turnier nicht gefunden');
  if (tournament.visibility === 'public') return;

  await db.transaction('rw', db.tournaments, db.sync, async () => {
    await db.tournaments.update(tournamentId, { visibility: 'public', updatedAt: Date.now() });
    const row: SyncRow = {
      tournamentId,
      role: 'owner',
      revision: 0,
      pending: [],
      protected: password != null,
      adminPassword: password,
      lastSyncedAt: null,
      error: null,
    };
    await db.sync.put(row);
  });

  scheduleSync(tournamentId);
}

/**
 * Fetches a public tournament by id and stores it on this device (role
 * 'joined'). If it is already here, it syncs instead. Throws SyncError with
 * `not_found`, `deleted`, `offline` or `unavailable`.
 */
export async function joinTournament(tournamentId: string): Promise<void> {
  const existing = await db.tournaments.get(tournamentId);
  if (existing) {
    if (existing.visibility === 'public') {
      await runSyncNow(tournamentId);
      return;
    }
    throw new SyncError('rejected', [], 'Diese Turnier-Id ist auf diesem Gerät bereits lokal vorhanden');
  }

  const fetched = await api.fetchTournament(tournamentId);
  await db.transaction('rw', db.tournaments, db.players, db.matches, db.sync, async () => {
    await db.tournaments.add({ ...fetched.snapshot.tournament, visibility: 'public' });
    if (fetched.snapshot.players.length > 0) await db.players.bulkAdd(fetched.snapshot.players);
    if (fetched.snapshot.matches.length > 0) await db.matches.bulkAdd(fetched.snapshot.matches);
    const row: SyncRow = {
      tournamentId,
      role: 'joined',
      revision: fetched.revision,
      pending: [],
      protected: fetched.protected,
      adminPassword: null,
      lastSyncedAt: Date.now(),
      error: null,
    };
    await db.sync.put(row);
  });
}

/* ------------------------------------------------------------------------ */
/* Admin password                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Checks the password with the server and remembers it on this device.
 * Returns false for a wrong password. Throws SyncError `offline` or
 * `unavailable`; too many wrong attempts (HTTP 429) throw `rejected`.
 */
export async function unlockTournament(tournamentId: string, password: string): Promise<boolean> {
  const ok = await api.unlockTournament(tournamentId, password);
  if (!ok) return false;

  await db.transaction('rw', db.sync, async () => {
    const sync = await db.sync.get(tournamentId);
    if (!sync) return;
    await db.sync.update(tournamentId, {
      adminPassword: password,
      error: sync.error === 'locked' ? null : sync.error,
    });
  });

  scheduleSync(tournamentId);
  return true;
}

/** Forgets the remembered password on this device. */
export async function lockTournament(tournamentId: string): Promise<void> {
  const sync = await db.sync.get(tournamentId);
  if (!sync) return;
  await db.sync.update(tournamentId, { adminPassword: null });
}

/**
 * Sets, changes (`next` = string) or removes (`next` = null) the password.
 * The remembered password is sent as the current one, so the device must be
 * unlocked when a password is set. Online only. Throws SyncError `locked` or
 * `wrong_password`.
 */
export async function changeTournamentPassword(tournamentId: string, next: string | null): Promise<void> {
  const sync = await db.sync.get(tournamentId);
  if (!sync) throw new SyncError('rejected', [], 'Kein öffentliches Turnier');

  await api.setPassword(tournamentId, sync.adminPassword, next);

  await db.sync.update(tournamentId, { adminPassword: next, protected: next != null });
}

/* ------------------------------------------------------------------------ */
/* Leaving and deleting                                                       */
/* ------------------------------------------------------------------------ */

async function removeLocalCopy(tournamentId: string): Promise<void> {
  await db.transaction('rw', db.tournaments, db.players, db.matches, db.sync, async () => {
    await db.matches.where('tournamentId').equals(tournamentId).delete();
    await db.players.where('tournamentId').equals(tournamentId).delete();
    await db.tournaments.delete(tournamentId);
    await db.sync.delete(tournamentId);
  });
  forceCloseLiveSync(tournamentId);
}

/** Removes a public tournament from this device only. Everyone else keeps it. Always allowed. */
export async function leaveTournament(tournamentId: string): Promise<void> {
  await removeLocalCopy(tournamentId);
}

/**
 * Deletes the tournament on the server for everyone, then on this device.
 * Online only. Needs the password if one is set: throws SyncError `locked`.
 */
export async function deleteTournamentEverywhere(tournamentId: string): Promise<void> {
  const sync = await db.sync.get(tournamentId);
  if (!sync) throw new SyncError('rejected', [], 'Kein öffentliches Turnier');

  await api.deleteTournament(tournamentId, sync.adminPassword);
  await removeLocalCopy(tournamentId);
}

/**
 * Throws away queued changes and resets the local copy to the server's
 * latest revision. This is the way out after a `locked` notice when nobody
 * knows the password.
 */
export async function discardPendingChanges(tournamentId: string): Promise<void> {
  const read = await readSyncAndSnapshot(tournamentId);
  if (!read) return;

  if (read.sync.revision === 0) {
    // Never uploaded: there is nothing server-side to reset to, just drop the queue.
    await db.sync.update(tournamentId, { pending: [], error: null });
    return;
  }

  const fetched = await api.fetchTournament(tournamentId);
  await db.transaction('rw', db.tournaments, db.players, db.matches, db.sync, async () => {
    await writeSnapshotRows(fetched.snapshot);
    await db.sync.update(tournamentId, {
      revision: fetched.revision,
      protected: fetched.protected,
      pending: [],
      lastSyncedAt: Date.now(),
      error: null,
    });
  });
}
