import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { listMatches, listPlayers, listTournaments, setMatchResult } from '../src/db/repo';
import { BACKUP_FORMAT, exportBackup, importBackup, parseBackup } from '../src/db/backup';
import { normalizeMatch, normalizeTournament } from '../src/db/normalize';
import { replayElo } from '../src/domain/elo';
import { buildStandings } from '../src/domain/standings';
import { groupRounds } from '../src/domain/schedule';
import { DEFAULT_ELO_SETTINGS, DEFAULT_PLAY_SETTINGS, type Tournament } from '../src/domain/types';

/*
 * Rows in the shape the app wrote before the single-elim-only refactor:
 * four formats, `matchFormat`, `play.swissRounds`/`grandFinalReset`/
 * `participantLimit`, no `timedMode`. Devices still hold data like this,
 * and old backup files contain it.
 */

const T0 = 1_700_000_000_000;
const OLD_ELO = { ...DEFAULT_ELO_SETTINGS };
const OLD_PLAY = {
  pointsToWin: 21,
  swissRounds: 5,
  participantLimit: 8,
  thirdPlaceMatch: true,
  grandFinalReset: true,
};

function oldTournament(id: string, fields: Record<string, unknown>) {
  return {
    id,
    name: id,
    note: '',
    createdAt: T0,
    updatedAt: T0,
    phase: 'tournament',
    status: 'running',
    matchFormat: '2v2',
    format: 'round_robin',
    elo: OLD_ELO,
    play: OLD_PLAY,
    bracket: null,
    clonedFrom: null,
    startedAt: T0,
    finishedAt: null,
    ...fields,
  };
}

function oldPlayer(id: string, tournamentId: string, inTournament = true) {
  return {
    id,
    tournamentId,
    name: id.toUpperCase(),
    baseElo: 1000,
    elo: 1000,
    createdAt: T0,
    active: true,
    inTournament,
    origin: null,
  };
}

function oldMatch(id: string, tournamentId: string, fields: Record<string, unknown>) {
  return {
    id,
    tournamentId,
    stage: 'round_robin',
    round: 1,
    order: 0,
    teamA: [],
    teamB: [],
    scoreA: null,
    scoreB: null,
    status: 'scheduled',
    bye: false,
    createdAt: T0,
    playedAt: null,
    sequence: 0,
    feedsWinnerTo: null,
    feedsLoserTo: null,
    labelA: null,
    labelB: null,
    ...fields,
  };
}

function played(scoreA: number, scoreB: number, sequence: number) {
  return { scoreA, scoreB, status: 'done', playedAt: T0 + sequence, sequence };
}

const LEGACY = {
  tournaments: [
    // Round robin, mid-schedule, one casual game played before it started.
    oldTournament('rr', {}),
    // Double elim, mid-bracket: a current stage mixed with removed ones.
    oldTournament('de', {
      format: 'double_elim',
      bracket: { format: 'double_elim', size: 2, teams: [], createdAt: T0 },
    }),
    // Swiss, already finished.
    oldTournament('sw', { format: 'swiss', status: 'finished', finishedAt: T0 + 99 }),
    // Singles single-elim final, still to be played: the format survives.
    oldTournament('se', {
      matchFormat: '1v1',
      format: 'single_elim',
      bracket: {
        format: 'single_elim',
        size: 2,
        teams: [
          { id: 'bt7', playerIds: ['p7'], seed: 1, name: 'P7' },
          { id: 'bt8', playerIds: ['p8'], seed: 2, name: 'P8' },
        ],
        createdAt: T0,
      },
    }),
    // Never left the casual queue.
    oldTournament('ca', { phase: 'casual', status: 'open', format: null, startedAt: null }),
  ],
  players: [
    ...['p1', 'p2', 'p3', 'p4'].map((id) => oldPlayer(id, 'rr')),
    oldPlayer('p5', 'de'),
    oldPlayer('p6', 'de'),
    oldPlayer('s1', 'sw'),
    oldPlayer('s2', 'sw'),
    oldPlayer('p7', 'se'),
    oldPlayer('p8', 'se'),
    oldPlayer('c1', 'ca', false),
    oldPlayer('c2', 'ca', false),
  ],
  matches: [
    oldMatch('rr-casual', 'rr', {
      stage: 'casual', teamA: ['p1', 'p3'], teamB: ['p2', 'p4'], ...played(15, 21, 1),
    }),
    oldMatch('rr-1', 'rr', {
      teamA: ['p1', 'p2'], teamB: ['p3', 'p4'], ...played(21, 14, 2),
    }),
    oldMatch('rr-2', 'rr', { round: 2, teamA: ['p1', 'p4'], teamB: ['p2', 'p3'] }),
    oldMatch('rr-bye', 'rr', {
      round: 2, order: 1, teamA: ['p1'], teamB: [], bye: true, status: 'done',
    }),

    oldMatch('de-w1', 'de', {
      stage: 'winners', teamA: ['p5'], teamB: ['p6'], ...played(21, 9, 1),
      feedsWinnerTo: { matchId: 'de-gf', slot: 'A' }, feedsLoserTo: { matchId: 'de-l1', slot: 'A' },
    }),
    oldMatch('de-l1', 'de', { stage: 'losers', teamA: ['p6'], labelB: 'Verlierer WB1.2' }),
    oldMatch('de-gf', 'de', { stage: 'grand_final', round: 2, teamA: ['p5'], labelB: 'Sieger LB1.1' }),
    oldMatch('de-gfr', 'de', { stage: 'grand_final_reset', round: 3 }),

    oldMatch('sw-1', 'sw', { stage: 'swiss', teamA: ['s1'], teamB: ['s2'], ...played(21, 19, 1) }),

    oldMatch('se-f', 'se', { stage: 'winners', teamA: ['p7'], teamB: ['p8'] }),

    oldMatch('ca-1', 'ca', { stage: 'casual', teamA: ['c1'], teamB: ['c2'], ...played(21, 11, 1) }),
  ],
};

/** A database exactly as the pre-v3 app left it: same name, v1/v2 schema. */
async function seedLegacyDatabase(): Promise<void> {
  const legacy = new Dexie('rally');
  legacy.version(1).stores({
    tournaments: 'id, createdAt, updatedAt, status',
    players: 'id, tournamentId, [tournamentId+active], [tournamentId+inTournament], name',
    matches:
      'id, tournamentId, sequence, [tournamentId+stage], [tournamentId+status], [tournamentId+round]',
    meta: 'key',
  });
  legacy.version(2).stores({ sync: 'tournamentId' });
  await legacy.open();
  await legacy.table('tournaments').bulkAdd(LEGACY.tournaments);
  await legacy.table('players').bulkAdd(LEGACY.players);
  await legacy.table('matches').bulkAdd(LEGACY.matches);
  expect(legacy.verno).toBe(2);
  legacy.close();
}

async function tournament(id: string): Promise<Tournament> {
  return (await listTournaments()).find((t) => t.id === id)!;
}

function expectCurrentShape(t: Tournament) {
  const loose = t as unknown as Record<string, unknown>;
  const play = t.play as unknown as Record<string, unknown>;
  expect(loose).not.toHaveProperty('matchFormat');
  expect(play).not.toHaveProperty('swissRounds');
  expect(play).not.toHaveProperty('grandFinalReset');
  expect(play).not.toHaveProperty('participantLimit');
  expect(t.play.pointsToWin).toBe(21);
  expect(t.play.thirdPlaceMatch).toBe(true);
  expect(t.timedMode).toBeNull();
  expect(t.visibility).toBe('local');
}

describe('Dexie v3 upgrade of a pre-refactor database', () => {
  beforeEach(async () => {
    await db.delete();
    await seedLegacyDatabase();
    await db.open();
  });

  afterEach(() => db.close());

  it('opens at the current version with every tournament in the current shape', async () => {
    expect(db.verno).toBe(3);
    const all = await listTournaments();
    expect(all).toHaveLength(5);
    for (const t of all) expectCurrentShape(t);
  });

  it('sends a mid-schedule round robin back to the casual queue', async () => {
    const rr = await tournament('rr');
    expect(rr).toMatchObject({
      phase: 'casual',
      status: 'open',
      format: null,
      bracket: null,
      startedAt: null,
      finishedAt: null,
    });
    const players = await listPlayers('rr');
    expect(players.every((p) => !p.inTournament)).toBe(true);
  });

  it('keeps every round-robin result as casual history that still rates', async () => {
    const rr = await tournament('rr');
    const matches = await listMatches('rr');
    expect(matches.map((m) => m.id).sort()).toEqual(['rr-1', 'rr-2', 'rr-bye', 'rr-casual']);
    expect(matches.every((m) => m.stage === 'casual')).toBe(true);
    // The pairing already on court stays playable as a casual game.
    expect(matches.find((m) => m.id === 'rr-2')).toMatchObject({
      status: 'scheduled',
      teamA: ['p1', 'p4'],
      teamB: ['p2', 'p3'],
    });

    const players = await listPlayers('rr');
    const replay = replayElo(players, matches, rr.elo);
    expect(Object.keys(replay.perMatch).sort()).toEqual(['rr-1', 'rr-casual']);
    // Casual: p2+p4 beat p1+p3. Round robin: p1+p2 beat p3+p4.
    const standings = buildStandings(players, matches, replay);
    const record = (id: string) => {
      const row = standings.find((r) => r.playerId === id)!;
      return [row.played, row.wins, row.losses];
    };
    expect(record('p1')).toEqual([2, 1, 1]);
    expect(record('p2')).toEqual([2, 2, 0]);
    expect(record('p3')).toEqual([2, 0, 2]);
    expect(record('p4')).toEqual([2, 1, 1]);
    // Nothing is left for the round tabs to draw.
    expect(groupRounds(matches)).toEqual([]);
  });

  it('flattens a double-elim bracket, keeping the played match and dropping unfillable slots', async () => {
    const de = await tournament('de');
    expect(de).toMatchObject({ phase: 'casual', format: null, bracket: null });

    const matches = await listMatches('de');
    // Losers and grand-final slots were waiting on feeds that no longer
    // exist, so nothing could ever complete them; they held no result.
    expect(matches.map((m) => m.id)).toEqual(['de-w1']);
    expect(matches[0]).toMatchObject({
      stage: 'casual',
      status: 'done',
      scoreA: 21,
      scoreB: 9,
      feedsWinnerTo: null,
      feedsLoserTo: null,
    });

    const players = await listPlayers('de');
    const replay = replayElo(players, matches, de.elo);
    expect(replay.ratings.p5).toBeGreaterThan(1000);
    expect(replay.ratings.p6).toBeLessThan(1000);
  });

  it('reopens a finished Swiss tournament without losing its results', async () => {
    const sw = await tournament('sw');
    expect(sw).toMatchObject({ phase: 'casual', status: 'open', finishedAt: null });
    const matches = await listMatches('sw');
    const standings = buildStandings(
      await listPlayers('sw'),
      matches,
      replayElo(await listPlayers('sw'), matches, sw.elo),
      { stages: ['casual'] },
    );
    expect(standings[0]).toMatchObject({ playerId: 's1', wins: 1 });
  });

  it('leaves a singles single-elim bracket running and playable', async () => {
    const se = await tournament('se');
    expect(se).toMatchObject({ phase: 'tournament', status: 'running', format: 'single_elim' });
    expect(se.bracket!.teams.map((team) => team.playerIds)).toEqual([['p7'], ['p8']]);
    expect((await listPlayers('se')).every((p) => p.inTournament)).toBe(true);

    const [final] = await listMatches('se');
    expect(final).toMatchObject({ stage: 'winners', teamA: ['p7'], teamB: ['p8'] });

    // Singles go through the normal result path and bracket resolution.
    await setMatchResult('se-f', 21, 18);
    const after = await tournament('se');
    expect(after.status).toBe('finished');
    const players = await listPlayers('se');
    expect(players.find((p) => p.id === 'p7')!.elo).toBeGreaterThan(1000);
    expect(players.find((p) => p.id === 'p8')!.elo).toBeLessThan(1000);
  });

  it('leaves a casual tournament alone apart from the shape', async () => {
    const ca = await tournament('ca');
    expect(ca).toMatchObject({ phase: 'casual', status: 'open', format: null });
    const [match] = await listMatches('ca');
    expect(match).toMatchObject({ stage: 'casual', status: 'done', scoreA: 21 });
  });
});

describe('importBackup of a pre-refactor export', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('lands as valid current tournaments, same rules as the upgrade', async () => {
    const file = parseBackup(
      JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: 'x', ...LEGACY }),
    );
    const result = await importBackup(file);
    // de-l1, de-gf and de-gfr are the unfillable placeholders.
    expect(result).toEqual({ tournaments: 5, players: 12, matches: LEGACY.matches.length - 3 });

    const all = await listTournaments();
    for (const t of all) expectCurrentShape(t);

    const rr = all.find((t) => t.name === 'rr')!;
    expect(rr).toMatchObject({ phase: 'casual', status: 'open', format: null });
    const matches = await listMatches(rr.id);
    expect(matches).toHaveLength(4);
    expect(matches.every((m) => m.stage === 'casual')).toBe(true);
    const players = await listPlayers(rr.id);
    expect(players.every((p) => !p.inTournament)).toBe(true);
    const standings = buildStandings(players, matches, replayElo(players, matches, rr.elo));
    expect(standings.every((row) => row.played === 2)).toBe(true);

    const de = all.find((t) => t.name === 'de')!;
    const [kept] = await listMatches(de.id);
    expect(kept).toMatchObject({ stage: 'casual', feedsWinnerTo: null, feedsLoserTo: null });

    // The surviving bracket is remapped consistently: bracket teams and the
    // final point at the imported players.
    const se = all.find((t) => t.name === 'se')!;
    expect(se).toMatchObject({ phase: 'tournament', format: 'single_elim' });
    const sePlayers = new Set((await listPlayers(se.id)).map((p) => p.id));
    const [final] = await listMatches(se.id);
    expect(final!.stage).toBe('winners');
    for (const id of [...final!.teamA, ...final!.teamB, ...se.bracket!.teams.flatMap((t) => t.playerIds)]) {
      expect(sePlayers.has(id)).toBe(true);
    }
  });

  it('round-trips a current export unchanged apart from ids', async () => {
    const id = 'fresh';
    await db.tournaments.add({
      id,
      name: 'Frisch',
      note: 'Notiz',
      createdAt: T0,
      updatedAt: T0,
      phase: 'casual',
      status: 'open',
      format: null,
      elo: { ...DEFAULT_ELO_SETTINGS },
      play: { ...DEFAULT_PLAY_SETTINGS },
      bracket: null,
      clonedFrom: null,
      startedAt: null,
      finishedAt: null,
      timedMode: { freePlayMinutes: 60, draftSize: 8, timerStartedAt: null, maxPartnerRepeats: 2 },
      visibility: 'local',
    });

    const exported = await exportBackup([id]);
    await importBackup(exported);
    const copy = (await listTournaments()).find((t) => t.id !== id)!;
    const original = exported.tournaments[0]!;
    const { play: originalPlay, ...originalRest } = original;
    const { play: copyPlay, ...copyRest } = copy;
    expect({ ...copyRest, id, updatedAt: T0 }).toEqual(originalRest);
    expect(copyPlay).toEqual({
      pointsToWin: originalPlay.pointsToWin,
      thirdPlaceMatch: originalPlay.thirdPlaceMatch,
    });
  });
});

describe('normalisation is idempotent', () => {
  it('leaves already-normalised rows unchanged', () => {
    for (const raw of LEGACY.tournaments) {
      const once = normalizeTournament(raw);
      const twice = normalizeTournament(once.tournament as unknown as Record<string, unknown>);
      expect(twice.tournament).toEqual(once.tournament);
      expect(twice.reverted).toBe(false);
    }
    for (const raw of LEGACY.matches) {
      const once = normalizeMatch(raw, { tournamentReverted: true });
      if (!once) continue;
      const again = normalizeMatch(once as unknown as Record<string, unknown>, {
        tournamentReverted: false,
      });
      expect(again).toEqual(once);
    }
  });
});
