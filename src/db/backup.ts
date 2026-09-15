import { db, makeId } from './db';
import type { Match, Player, Tournament } from '../domain/types';

export const BACKUP_FORMAT = 'rally-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  tournaments: Tournament[];
  players: Player[];
  matches: Match[];
}

/**
 * Everything lives on one device, so a JSON dump is the safety net: it can be
 * mailed to yourself, dropped in a cloud folder, or imported on a new phone.
 */
export async function exportBackup(tournamentIds?: string[]): Promise<BackupFile> {
  const tournaments = tournamentIds
    ? ((await db.tournaments.bulkGet(tournamentIds)).filter(Boolean) as Tournament[])
    : await db.tournaments.toArray();
  const ids = new Set(tournaments.map((tournament) => tournament.id));

  const players = (await db.players.toArray()).filter((player) => ids.has(player.tournamentId));
  const matches = (await db.matches.toArray()).filter((match) => ids.has(match.tournamentId));

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    tournaments,
    players,
    matches,
  };
}

export function backupFileName(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `rally-backup-${stamp}.json`;
}

export class BackupFormatError extends Error {}

export function parseBackup(raw: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BackupFormatError('Die Datei ist kein gueltiges JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new BackupFormatError('Die Datei enthaelt kein Backup.');
  }
  const candidate = parsed as Partial<BackupFile>;
  if (candidate.format !== BACKUP_FORMAT) {
    throw new BackupFormatError('Das ist kein Rally-Backup.');
  }
  if (typeof candidate.version !== 'number' || candidate.version > BACKUP_VERSION) {
    throw new BackupFormatError('Das Backup stammt aus einer neueren Version der App.');
  }
  if (
    !Array.isArray(candidate.tournaments) ||
    !Array.isArray(candidate.players) ||
    !Array.isArray(candidate.matches)
  ) {
    throw new BackupFormatError('Dem Backup fehlen Daten.');
  }
  return candidate as BackupFile;
}

export interface ImportResult {
  tournaments: number;
  players: number;
  matches: number;
}

/**
 * Imports a backup as new tournaments.
 *
 * Every id is remapped, so importing the same file twice creates two separate
 * copies instead of overwriting what is already on the device. Nothing that
 * exists can be destroyed by an import.
 */
export async function importBackup(file: BackupFile): Promise<ImportResult> {
  const tournamentIds = new Map<string, string>();
  const playerIds = new Map<string, string>();
  const matchIds = new Map<string, string>();

  for (const tournament of file.tournaments) tournamentIds.set(tournament.id, makeId());
  for (const player of file.players) playerIds.set(player.id, makeId());
  for (const match of file.matches) matchIds.set(match.id, makeId());

  const remapPlayers = (ids: string[]) =>
    ids.map((id) => playerIds.get(id)).filter((id): id is string => Boolean(id));

  const now = Date.now();

  const tournaments: Tournament[] = file.tournaments.map((tournament) => ({
    ...tournament,
    id: tournamentIds.get(tournament.id)!,
    updatedAt: now,
    clonedFrom: tournament.clonedFrom
      ? {
          ...tournament.clonedFrom,
          tournamentId:
            tournamentIds.get(tournament.clonedFrom.tournamentId) ??
            tournament.clonedFrom.tournamentId,
        }
      : null,
    bracket: tournament.bracket
      ? {
          ...tournament.bracket,
          teams: tournament.bracket.teams.map((team) => ({
            ...team,
            id: makeId(),
            playerIds: remapPlayers(team.playerIds),
          })),
        }
      : null,
  }));

  const players: Player[] = file.players
    .filter((player) => tournamentIds.has(player.tournamentId))
    .map((player) => ({
      ...player,
      id: playerIds.get(player.id)!,
      tournamentId: tournamentIds.get(player.tournamentId)!,
      // The origin points at a tournament that may not be part of this file.
      origin: null,
    }));

  const matches: Match[] = file.matches
    .filter((match) => tournamentIds.has(match.tournamentId))
    .map((match) => ({
      ...match,
      id: matchIds.get(match.id)!,
      tournamentId: tournamentIds.get(match.tournamentId)!,
      teamA: remapPlayers(match.teamA),
      teamB: remapPlayers(match.teamB),
      feedsWinnerTo: match.feedsWinnerTo
        ? { ...match.feedsWinnerTo, matchId: matchIds.get(match.feedsWinnerTo.matchId)! }
        : null,
      feedsLoserTo: match.feedsLoserTo
        ? { ...match.feedsLoserTo, matchId: matchIds.get(match.feedsLoserTo.matchId)! }
        : null,
    }));

  await db.transaction('rw', db.tournaments, db.players, db.matches, async () => {
    await db.tournaments.bulkAdd(tournaments);
    if (players.length > 0) await db.players.bulkAdd(players);
    if (matches.length > 0) await db.matches.bulkAdd(matches);
  });

  return {
    tournaments: tournaments.length,
    players: players.length,
    matches: matches.length,
  };
}

/** Wipes the database. Only reachable behind an explicit confirmation. */
export async function eraseEverything(): Promise<void> {
  await db.transaction('rw', db.tournaments, db.players, db.matches, db.meta, async () => {
    await db.matches.clear();
    await db.players.clear();
    await db.tournaments.clear();
    await db.meta.clear();
  });
}
