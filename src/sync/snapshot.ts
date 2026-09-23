/**
 * Reading and writing whole-tournament snapshots. Kept separate from the
 * engine so the "replace local rows with a server snapshot" step (used by
 * replay, an ordinary pull, join and discard) has one implementation.
 */
import { db, type SyncRow } from '../db/db';
import type { TournamentSnapshot } from './protocol';
import type { ProtectionInput } from './protection';

/** Reads the sync row and a consistent snapshot together, inside one read transaction. */
export async function readSyncAndSnapshot(
  tournamentId: string,
): Promise<{ sync: SyncRow; snapshot: TournamentSnapshot } | null> {
  return db.transaction('r', db.sync, db.tournaments, db.players, db.matches, async () => {
    const sync = await db.sync.get(tournamentId);
    const tournament = await db.tournaments.get(tournamentId);
    if (!sync || !tournament) return null;
    const players = await db.players.where('tournamentId').equals(tournamentId).toArray();
    const matches = await db.matches.where('tournamentId').equals(tournamentId).toArray();
    return { sync, snapshot: { tournament, players, matches } };
  });
}

export async function readProtectionSnapshot(tournamentId: string): Promise<ProtectionInput> {
  const tournament = await db.tournaments.get(tournamentId);
  if (!tournament) throw new Error(`readProtectionSnapshot: tournament ${tournamentId} not found`);
  const players = await db.players.where('tournamentId').equals(tournamentId).toArray();
  const matches = await db.matches.where('tournamentId').equals(tournamentId).toArray();
  return { tournament, players, matches };
}

/**
 * Replaces a tournament's rows with a server snapshot, inside the caller's
 * own transaction (over at least tournaments, players, matches). Deliberately
 * does NOT run recalculate(): the snapshot already holds derived state
 * (ratings, bracket progression), and recomputing it here would just be
 * redoing work the pushing device already did.
 */
export async function writeSnapshotRows(snapshot: TournamentSnapshot): Promise<void> {
  const tournamentId = snapshot.tournament.id;
  await db.matches.where('tournamentId').equals(tournamentId).delete();
  await db.players.where('tournamentId').equals(tournamentId).delete();
  await db.tournaments.put({ ...snapshot.tournament, visibility: 'public' });
  if (snapshot.players.length > 0) await db.players.bulkAdd(snapshot.players);
  if (snapshot.matches.length > 0) await db.matches.bulkAdd(snapshot.matches);
}
