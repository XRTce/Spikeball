import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import {
  addPlayer,
  backToCasual,
  clonePlayersFrom,
  createTournament,
  deletePlayer,
  generateNextSwissRound,
  listMatches,
  listPlayers,
  recordCasualResult,
  setMatchResult,
  startTournament,
  updatePlayer,
} from '../src/db/repo';
import { exportBackup, importBackup, parseBackup, BackupFormatError } from '../src/db/backup';
import { bracketResult } from '../src/domain/pairing/elimination';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function seedTournament(playerCount: number, name = 'Grillabend'): Promise<{
  tournamentId: string;
  playerIds: string[];
}> {
  const tournamentId = await createTournament({ name });
  const playerIds: string[] = [];
  for (let i = 1; i <= playerCount; i += 1) {
    playerIds.push(await addPlayer(tournamentId, `Spieler ${i}`));
  }
  return { tournamentId, playerIds };
}

describe('tournaments and players', () => {
  it('creates a tournament with default settings', async () => {
    const id = await createTournament({ name: '  Sommerfest  ' });
    const tournament = await db.tournaments.get(id);
    expect(tournament?.name).toBe('Sommerfest');
    expect(tournament?.phase).toBe('casual');
    expect(tournament?.elo.baseElo).toBe(1000);
  });

  it('starts every player at the tournament base rating', async () => {
    const { tournamentId, playerIds } = await seedTournament(2);
    const players = await listPlayers(tournamentId);
    expect(players).toHaveLength(2);
    expect(players.every((player) => player.elo === 1000 && player.baseElo === 1000)).toBe(true);
    expect(playerIds).toHaveLength(2);
  });

  it('accepts a custom base rating for a stronger player', async () => {
    const tournamentId = await createTournament({ name: 'Liga' });
    const id = await addPlayer(tournamentId, 'Profi', 1350);
    const player = await db.players.get(id);
    expect(player?.baseElo).toBe(1350);
    expect(player?.elo).toBe(1350);
  });
});

describe('casual results', () => {
  it('moves ratings and keeps them zero-sum for equal K', async () => {
    const { tournamentId, playerIds } = await seedTournament(4);
    const [a, b, c, d] = playerIds as [string, string, string, string];

    await recordCasualResult(tournamentId, [a, b], [c, d], 21, 14);
    const players = await listPlayers(tournamentId);
    const byId = new Map(players.map((player) => [player.id, player]));

    expect(byId.get(a)!.elo).toBeGreaterThan(1000);
    expect(byId.get(c)!.elo).toBeLessThan(1000);
    const total = players.reduce((sum, player) => sum + player.elo, 0);
    expect(total).toBe(4000);
  });

  it('reverts ratings when a result is corrected', async () => {
    const { tournamentId, playerIds } = await seedTournament(4);
    const [a, b, c, d] = playerIds as [string, string, string, string];

    await recordCasualResult(tournamentId, [a, b], [c, d], 21, 14);
    const afterWin = (await db.players.get(a))!.elo;
    expect(afterWin).toBeGreaterThan(1000);

    const [match] = await listMatches(tournamentId);
    await setMatchResult(match!.id, 14, 21);
    const afterFlip = (await db.players.get(a))!.elo;
    expect(afterFlip).toBeLessThan(1000);
  });

  it('replays from the new base when a base rating is edited', async () => {
    const { tournamentId, playerIds } = await seedTournament(4);
    const [a, b, c, d] = playerIds as [string, string, string, string];
    await recordCasualResult(tournamentId, [a, b], [c, d], 21, 10);

    const before = (await db.players.get(a))!.elo;
    await updatePlayer(a, { baseElo: 1200 });
    const after = (await db.players.get(a))!.elo;

    expect(after).toBeGreaterThan(1200);
    // The same win is worth less once the winner is the clear favourite, so
    // the rating does not simply shift by the 200 points that were added.
    expect(after - 1200).toBeLessThan(before - 1000);
  });

  it('removes a player together with their matches', async () => {
    const { tournamentId, playerIds } = await seedTournament(4);
    const [a, b, c, d] = playerIds as [string, string, string, string];
    await recordCasualResult(tournamentId, [a, b], [c, d], 21, 10);

    await deletePlayer(a);
    expect(await listPlayers(tournamentId)).toHaveLength(3);
    expect(await listMatches(tournamentId)).toHaveLength(0);
    // The other three are back at their base rating.
    const players = await listPlayers(tournamentId);
    expect(players.every((player) => player.elo === 1000)).toBe(true);
  });
});

describe('cloning players between tournaments', () => {
  it('carries the current rating over as the new base rating', async () => {
    const { tournamentId, playerIds } = await seedTournament(4, 'Abend 1');
    const [a, b, c, d] = playerIds as [string, string, string, string];
    await recordCasualResult(tournamentId, [a, b], [c, d], 21, 8);
    const winnerElo = (await db.players.get(a))!.elo;

    const nextId = await createTournament({ name: 'Abend 2' });
    const copied = await clonePlayersFrom(nextId, tournamentId, 'current');
    expect(copied).toBe(4);

    const cloned = await listPlayers(nextId);
    const winner = cloned.find((player) => player.name === 'Spieler 1')!;
    expect(winner.baseElo).toBe(winnerElo);
    expect(winner.elo).toBe(winnerElo);
    expect(winner.origin?.tournamentId).toBe(tournamentId);

    const tournament = await db.tournaments.get(nextId);
    expect(tournament?.clonedFrom?.name).toBe('Abend 1');
  });

  it('can reset everyone to their original base rating instead', async () => {
    const { tournamentId, playerIds } = await seedTournament(4, 'Abend 1');
    const [a, b, c, d] = playerIds as [string, string, string, string];
    await recordCasualResult(tournamentId, [a, b], [c, d], 21, 8);

    const nextId = await createTournament({ name: 'Abend 2' });
    await clonePlayersFrom(nextId, tournamentId, 'base');
    const cloned = await listPlayers(nextId);
    expect(cloned.every((player) => player.baseElo === 1000)).toBe(true);
  });

  it('clones on creation and skips names that already exist', async () => {
    const { tournamentId } = await seedTournament(3, 'Quelle');
    const nextId = await createTournament({
      name: 'Ziel',
      cloneFrom: { tournamentId, ratingSource: 'current' },
    });
    expect(await listPlayers(nextId)).toHaveLength(3);

    await clonePlayersFrom(nextId, tournamentId, 'current');
    expect(await listPlayers(nextId)).toHaveLength(3);
  });

  it('keeps the two tournaments' + " ratings independent", async () => {
    const { tournamentId, playerIds } = await seedTournament(4, 'Abend 1');
    const nextId = await createTournament({
      name: 'Abend 2',
      cloneFrom: { tournamentId, ratingSource: 'current' },
    });

    const clonedPlayers = await listPlayers(nextId);
    const [ca, cb, cc, cd] = clonedPlayers.map((player) => player.id) as [
      string,
      string,
      string,
      string,
    ];
    await recordCasualResult(nextId, [ca, cb], [cc, cd], 21, 5);

    const originals = await listPlayers(tournamentId);
    expect(originals.every((player) => player.elo === 1000)).toBe(true);
    expect(playerIds).toHaveLength(4);
  });
});

describe('tournament mode', () => {
  it('generates a full round robin and keeps casual matches', async () => {
    const { tournamentId, playerIds } = await seedTournament(8);
    const [a, b, c, d] = playerIds as [string, string, string, string];
    await recordCasualResult(tournamentId, [a, b], [c, d], 21, 15);

    const result = await startTournament({
      tournamentId,
      format: 'round_robin',
      participantIds: playerIds,
      seed: 5,
    });
    expect(result.matches).toBe(14);
    expect(result.rounds).toBe(7);

    const matches = await listMatches(tournamentId);
    expect(matches.filter((match) => match.stage === 'casual')).toHaveLength(1);
    expect(matches.filter((match) => match.stage === 'round_robin')).toHaveLength(14);

    const tournament = await db.tournaments.get(tournamentId);
    expect(tournament?.phase).toBe('tournament');
    expect(tournament?.status).toBe('running');
  });

  it('only counts the n best players when a smaller field is chosen', async () => {
    const { tournamentId, playerIds } = await seedTournament(8);
    const chosen = playerIds.slice(0, 4);
    await startTournament({ tournamentId, format: 'round_robin', participantIds: chosen, seed: 1 });

    const players = await listPlayers(tournamentId);
    expect(players.filter((player) => player.inTournament)).toHaveLength(4);
  });

  it('generates Swiss rounds one at a time', async () => {
    const { tournamentId, playerIds } = await seedTournament(8);
    await startTournament({
      tournamentId,
      format: 'swiss',
      participantIds: playerIds,
      swissRounds: 3,
    });

    expect(await generateNextSwissRound(tournamentId)).toBe(0); // round 1 still open

    for (const match of (await listMatches(tournamentId)).filter((m) => m.status === 'scheduled')) {
      await setMatchResult(match.id, 21, 15);
    }
    expect(await generateNextSwissRound(tournamentId)).toBe(2);

    const rounds = new Set((await listMatches(tournamentId)).map((match) => match.round));
    expect(rounds).toEqual(new Set([1, 2]));
  });

  it('stops generating Swiss rounds at the configured limit', async () => {
    const { tournamentId, playerIds } = await seedTournament(4);
    await startTournament({
      tournamentId,
      format: 'swiss',
      participantIds: playerIds,
      swissRounds: 1,
    });
    for (const match of (await listMatches(tournamentId)).filter((m) => m.status === 'scheduled')) {
      await setMatchResult(match.id, 21, 15);
    }
    expect(await generateNextSwissRound(tournamentId)).toBe(0);
  });

  it('plays a single elimination through to a champion', async () => {
    const { tournamentId, playerIds } = await seedTournament(8);
    await startTournament({
      tournamentId,
      format: 'single_elim',
      participantIds: playerIds,
      thirdPlaceMatch: true,
    });

    const tournament = await db.tournaments.get(tournamentId);
    expect(tournament?.bracket?.teams).toHaveLength(4);

    for (let guard = 0; guard < 40; guard += 1) {
      const open = (await listMatches(tournamentId)).find(
        (match) =>
          match.status === 'scheduled' && match.teamA.length > 0 && match.teamB.length > 0,
      );
      if (!open) break;
      await setMatchResult(open.id, 21, 15);
    }

    const matches = await listMatches(tournamentId);
    const result = bracketResult(matches, 'single_elim');
    expect(result.championIds).not.toBeNull();
    expect(result.complete).toBe(true);
    expect((await db.tournaments.get(tournamentId))?.status).toBe('finished');
  });

  it('adds and removes the double elimination decider as results change', async () => {
    const { tournamentId, playerIds } = await seedTournament(8);
    await startTournament({
      tournamentId,
      format: 'double_elim',
      participantIds: playerIds,
      grandFinalReset: true,
    });

    for (let guard = 0; guard < 60; guard += 1) {
      const open = (await listMatches(tournamentId)).find(
        (match) =>
          match.status === 'scheduled' && match.teamA.length > 0 && match.teamB.length > 0,
      );
      if (!open) break;
      await setMatchResult(open.id, 21, 15);
    }

    const grandFinal = (await listMatches(tournamentId)).find(
      (match) => match.stage === 'grand_final',
    )!;
    expect(grandFinal.status).toBe('done');
    expect(
      (await listMatches(tournamentId)).some((match) => match.stage === 'grand_final_reset'),
    ).toBe(false);

    // The losers bracket finalist wins: a decider appears.
    await setMatchResult(grandFinal.id, 15, 21);
    let reset = (await listMatches(tournamentId)).find(
      (match) => match.stage === 'grand_final_reset',
    );
    expect(reset).toBeDefined();
    expect(reset!.teamA).toHaveLength(2);
    expect(reset!.teamB).toHaveLength(2);

    // Correcting it back removes the decider again.
    await setMatchResult(grandFinal.id, 21, 15);
    reset = (await listMatches(tournamentId)).find((match) => match.stage === 'grand_final_reset');
    expect(reset).toBeUndefined();
  });

  it('returns to the open queue and keeps casual history', async () => {
    const { tournamentId, playerIds } = await seedTournament(8);
    const [a, b, c, d] = playerIds as [string, string, string, string];
    await recordCasualResult(tournamentId, [a, b], [c, d], 21, 15);
    await startTournament({ tournamentId, format: 'round_robin', participantIds: playerIds, seed: 2 });
    await backToCasual(tournamentId);

    const tournament = await db.tournaments.get(tournamentId);
    expect(tournament?.phase).toBe('casual');
    expect(tournament?.format).toBeNull();
    const matches = await listMatches(tournamentId);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.stage).toBe('casual');
  });
});

describe('backup', () => {
  it('round-trips a tournament into an independent copy', async () => {
    const { tournamentId, playerIds } = await seedTournament(4, 'Backup Test');
    const [a, b, c, d] = playerIds as [string, string, string, string];
    await recordCasualResult(tournamentId, [a, b], [c, d], 21, 12);

    const backup = await exportBackup([tournamentId]);
    expect(backup.tournaments).toHaveLength(1);
    expect(backup.players).toHaveLength(4);
    expect(backup.matches).toHaveLength(1);

    const parsed = parseBackup(JSON.stringify(backup));
    const imported = await importBackup(parsed);
    expect(imported.tournaments).toBe(1);
    expect(imported.players).toBe(4);

    expect(await db.tournaments.count()).toBe(2);
    const copies = (await db.tournaments.toArray()).filter((t) => t.name === 'Backup Test');
    expect(copies).toHaveLength(2);
    expect(copies[0]!.id).not.toBe(copies[1]!.id);

    // The imported match still points at the imported players.
    const importedTournament = copies.find((t) => t.id !== tournamentId)!;
    const importedPlayers = await listPlayers(importedTournament.id);
    const importedMatches = await listMatches(importedTournament.id);
    const importedIds = new Set(importedPlayers.map((player) => player.id));
    for (const id of [...importedMatches[0]!.teamA, ...importedMatches[0]!.teamB]) {
      expect(importedIds.has(id)).toBe(true);
    }
  });

  it('preserves bracket wiring across an import', async () => {
    const { tournamentId, playerIds } = await seedTournament(8);
    await startTournament({ tournamentId, format: 'double_elim', participantIds: playerIds });

    // Eight players form four doubles teams, so the bracket is 2*(4-1) matches.
    const imported = await importBackup(parseBackup(JSON.stringify(await exportBackup([tournamentId]))));
    expect(imported.matches).toBe(6);

    const copy = (await db.tournaments.toArray()).find((t) => t.id !== tournamentId)!;
    const matches = await listMatches(copy.id);
    const ids = new Set(matches.map((match) => match.id));
    for (const match of matches) {
      if (match.feedsWinnerTo) expect(ids.has(match.feedsWinnerTo.matchId)).toBe(true);
      if (match.feedsLoserTo) expect(ids.has(match.feedsLoserTo.matchId)).toBe(true);
    }
    expect(copy.bracket?.teams).toHaveLength(4);
  });

  it('rejects files that are not a Rally backup', () => {
    expect(() => parseBackup('not json')).toThrow(BackupFormatError);
    expect(() => parseBackup('{"format":"other"}')).toThrow(BackupFormatError);
    expect(() => parseBackup(JSON.stringify({ format: 'rally-backup', version: 99 }))).toThrow(
      BackupFormatError,
    );
  });
});
