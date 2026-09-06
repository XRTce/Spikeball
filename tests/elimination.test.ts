import { describe, expect, it } from 'vitest';
import {
  bracketResult,
  buildBracket,
  buildBracketTeams,
  buildDoubleElimination,
  buildSingleElimination,
  eliminationSize,
  grandFinalResetState,
  matchCode,
  nextPowerOfTwo,
  resolveBracket,
  seedOrder,
} from '../src/domain/pairing/elimination';
import type { BracketTeam, Match } from '../src/domain/types';
import { draftToMatch, recordResult, resetIds, resetSequence, nextId } from './helpers';

function makeTeams(count: number): BracketTeam[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `team${i + 1}`,
    playerIds: [`p${i * 2 + 1}`, `p${i * 2 + 2}`],
    seed: i + 1,
    name: `Team ${i + 1}`,
  }));
}

function build(format: 'single_elim' | 'double_elim', teamCount: number, thirdPlace = false) {
  resetIds();
  resetSequence();
  const teams = makeTeams(teamCount);
  const plan = buildBracket(format, teams, { thirdPlaceMatch: thirdPlace, makeId: () => nextId('bm') });
  return { teams, plan, matches: resolveBracket(plan.matches.map(draftToMatch)) };
}

/** Plays every playable match, always letting the better seed through. */
function playOut(matches: Match[], teams: BracketTeam[], upsets: Record<string, 'B'> = {}): Match[] {
  const seedOf = new Map<string, number>();
  for (const team of teams) seedOf.set(team.playerIds.join(','), team.seed);

  let current = matches;
  for (let guard = 0; guard < 200; guard += 1) {
    const next = current.find(
      (match) =>
        match.status === 'scheduled' && match.teamA.length > 0 && match.teamB.length > 0,
    );
    if (!next) break;
    const seedA = seedOf.get(next.teamA.join(',')) ?? 99;
    const seedB = seedOf.get(next.teamB.join(',')) ?? 99;
    const bWins = upsets[next.id] === 'B' || seedB < seedA;
    current = resolveBracket(
      recordResult(current, next.id, bWins ? 15 : 21, bWins ? 21 : 15),
    );
  }
  return current;
}

describe('seedOrder', () => {
  it('produces the standard bracket order', () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  });

  it('keeps the top two seeds in opposite halves', () => {
    for (const size of [4, 8, 16, 32]) {
      const order = seedOrder(size);
      expect(order.indexOf(1)).toBeLessThan(size / 2);
      expect(order.indexOf(2)).toBeGreaterThanOrEqual(size / 2);
    }
  });
});

describe('nextPowerOfTwo', () => {
  it('rounds up and never goes below two', () => {
    expect(nextPowerOfTwo(1)).toBe(2);
    expect(nextPowerOfTwo(5)).toBe(8);
    expect(nextPowerOfTwo(8)).toBe(8);
    expect(nextPowerOfTwo(9)).toBe(16);
  });
});

describe('buildBracketTeams', () => {
  it('snake-pairs the strongest player with the weakest', () => {
    const result = buildBracketTeams({
      playerIds: ['a', 'b', 'c', 'd'],
      ratings: { a: 1400, b: 1300, c: 1100, d: 900 },
      fallbackRating: 1000,
      teamSize: 2,
      nameOf: (id) => id,
      makeId: () => nextId('t'),
    });
    expect(result.unassigned).toEqual([]);
    const pairs = result.teams.map((team) => [...team.playerIds].sort().join(''));
    expect(pairs).toContain('ad');
    expect(pairs).toContain('bc');
  });

  it('leaves the weakest player out of an odd field', () => {
    const result = buildBracketTeams({
      playerIds: ['a', 'b', 'c', 'd', 'e'],
      ratings: { a: 1400, b: 1300, c: 1200, d: 1100, e: 900 },
      fallbackRating: 1000,
      teamSize: 2,
      nameOf: (id) => id,
      makeId: () => nextId('t'),
    });
    expect(result.unassigned).toEqual(['e']);
    expect(result.teams).toHaveLength(2);
  });

  it('seeds teams by combined rating', () => {
    const result = buildBracketTeams({
      playerIds: ['a', 'b', 'c', 'd'],
      ratings: { a: 1400, b: 1300, c: 1100, d: 900 },
      fallbackRating: 1000,
      teamSize: 2,
      nameOf: (id) => id,
      makeId: () => nextId('t'),
    });
    expect(result.teams[0]!.seed).toBe(1);
    expect(result.teams.map((t) => t.seed)).toEqual([1, 2]);
  });

  it('treats each player as their own team in singles', () => {
    const result = buildBracketTeams({
      playerIds: ['a', 'b', 'c'],
      ratings: { a: 1000, b: 1200, c: 1100 },
      fallbackRating: 1000,
      teamSize: 1,
      nameOf: (id) => id,
      makeId: () => nextId('t'),
    });
    expect(result.teams.map((t) => t.playerIds[0])).toEqual(['b', 'c', 'a']);
  });
});

describe('single elimination', () => {
  it('creates n-1 matches for a full bracket', () => {
    const { matches } = build('single_elim', 8);
    expect(matches).toHaveLength(7);
    expect(matches.filter((m) => m.round === 1)).toHaveLength(4);
    expect(matches.filter((m) => m.round === 3)).toHaveLength(1);
  });

  it('adds a third place match when requested', () => {
    const { matches } = build('single_elim', 8, true);
    expect(matches).toHaveLength(8);
    expect(matches.filter((m) => m.stage === 'third_place')).toHaveLength(1);
  });

  it('walks byes straight into round two', () => {
    const { matches } = build('single_elim', 6);
    const firstRound = matches.filter((m) => m.round === 1);
    expect(firstRound.filter((m) => m.bye)).toHaveLength(2);

    const secondRound = matches.filter((m) => m.round === 2);
    // Seeds 1 and 2 had byes, so both are already standing in the semi finals.
    const advanced = secondRound.flatMap((m) => [...m.teamA, ...m.teamB]);
    expect(advanced).toContain('p1');
    expect(advanced).toContain('p3');
  });

  it('lets the top seed win when there are no upsets', () => {
    const { teams, matches } = build('single_elim', 8, true);
    const played = playOut(matches, teams);
    const result = bracketResult(played, 'single_elim');
    expect(result.complete).toBe(true);
    expect(result.championIds).toEqual(teams[0]!.playerIds);
    expect(result.runnerUpIds).toEqual(teams[1]!.playerIds);
    expect(result.thirdIds).not.toBeNull();
  });

  it('reports the podium from the bracket, not the table', () => {
    const { teams, matches } = build('single_elim', 4, true);
    const final = matches.find((m) => m.round === 2 && m.stage === 'winners')!;
    const semisPlayed = playOut(matches, teams, {});
    const result = bracketResult(semisPlayed, 'single_elim');
    expect(result.championIds).toEqual(teams[0]!.playerIds);
    expect(final).toBeDefined();
  });

  it('re-resolves the whole bracket when an early result is corrected', () => {
    const { teams, matches } = build('single_elim', 4);
    const semi = matches.find((m) => m.round === 1 && m.order === 0)!;

    let state = resolveBracket(recordResult(matches, semi.id, 21, 10));
    let final = state.find((m) => m.round === 2)!;
    expect(final.teamA).toEqual(teams[0]!.playerIds);

    state = resolveBracket(recordResult(state, semi.id, 10, 21));
    final = state.find((m) => m.round === 2)!;
    expect(final.teamA).toEqual(teams[3]!.playerIds);
  });

  it('discards a downstream score that no longer belongs to the teams standing there', () => {
    const { matches } = build('single_elim', 4);
    const semiA = matches.find((m) => m.round === 1 && m.order === 0)!;
    const semiB = matches.find((m) => m.round === 1 && m.order === 1)!;

    let state = resolveBracket(recordResult(matches, semiA.id, 21, 10));
    state = resolveBracket(recordResult(state, semiB.id, 21, 10));
    const finalId = state.find((m) => m.round === 2)!.id;
    state = resolveBracket(recordResult(state, finalId, 21, 12));
    expect(state.find((m) => m.id === finalId)!.status).toBe('done');

    // Flip the first semi: the final now has a different team in slot A.
    state = resolveBracket(recordResult(state, semiA.id, 10, 21));
    const final = state.find((m) => m.id === finalId)!;
    expect(final.scoreA).toBeNull();
    expect(final.scoreB).toBeNull();
    expect(final.status).toBe('scheduled');
  });
});

describe('double elimination', () => {
  it('creates 2(n-1) matches for a full bracket', () => {
    for (const count of [4, 8, 16]) {
      const { matches } = build('double_elim', count);
      expect(matches, `${count} teams`).toHaveLength((count - 1) * 2);
    }
  });

  it('builds 2k-2 losers rounds plus a grand final', () => {
    const { plan } = build('double_elim', 8);
    const losersRounds = new Set(
      plan.matches.filter((m) => m.stage === 'losers').map((m) => m.round),
    );
    expect(losersRounds.size).toBe(4);
    expect(plan.matches.filter((m) => m.stage === 'grand_final')).toHaveLength(1);
  });

  it('routes every winners-bracket loser into the losers bracket', () => {
    const { plan } = build('double_elim', 8);
    const winners = plan.matches.filter((m) => m.stage === 'winners');
    for (const match of winners) {
      expect(match.feedsLoserTo, `${matchCode(match.stage, match.round, match.order)}`).not.toBeNull();
    }
  });

  it('fills every losers-bracket slot from exactly one source', () => {
    const { plan } = build('double_elim', 8);
    const feeds = new Map<string, number>();
    for (const match of plan.matches) {
      for (const feed of [match.feedsWinnerTo, match.feedsLoserTo]) {
        if (!feed) continue;
        const key = `${feed.matchId}:${feed.slot}`;
        feeds.set(key, (feeds.get(key) ?? 0) + 1);
      }
    }
    for (const count of feeds.values()) expect(count).toBe(1);

    const losers = plan.matches.filter((m) => m.stage === 'losers');
    for (const match of losers) {
      expect(feeds.get(`${match.id}:A`)).toBe(1);
      expect(feeds.get(`${match.id}:B`)).toBe(1);
    }
  });

  it('gives the winners-bracket winner the title when they hold the final', () => {
    const { teams, matches } = build('double_elim', 4);
    const played = playOut(matches, teams);
    expect(grandFinalResetState(played)).toBe('not-needed');
    const result = bracketResult(played, 'double_elim');
    expect(result.championIds).toEqual(teams[0]!.playerIds);
    expect(result.complete).toBe(true);
  });

  it('demands a decider when the losers finalist wins the grand final', () => {
    const { teams, matches } = build('double_elim', 4);
    let state = playOut(matches, teams);
    const grandFinal = state.find((m) => m.stage === 'grand_final')!;
    state = resolveBracket(recordResult(state, grandFinal.id, 15, 21));
    expect(grandFinalResetState(state)).toBe('needed');
  });

  it('lets a team lose once and still win the tournament', () => {
    const { teams, matches } = build('double_elim', 4);
    // Seed 1 loses their opening match, then runs through the losers bracket.
    const opener = matches.find(
      (m) => m.stage === 'winners' && m.round === 1 && m.teamA.join(',') === teams[0]!.playerIds.join(','),
    )!;
    let state = resolveBracket(recordResult(matches, opener.id, 15, 21));

    for (let guard = 0; guard < 40; guard += 1) {
      const next = state.find(
        (m) => m.status === 'scheduled' && m.teamA.length > 0 && m.teamB.length > 0,
      );
      if (!next) break;
      const seedOneIsA = next.teamA.join(',') === teams[0]!.playerIds.join(',');
      const seedOneIsB = next.teamB.join(',') === teams[0]!.playerIds.join(',');
      const aWins = seedOneIsA || !seedOneIsB;
      state = resolveBracket(recordResult(state, next.id, aWins ? 21 : 15, aWins ? 15 : 21));
    }

    const losersMatches = state.filter(
      (m) => m.stage === 'losers' && m.status === 'done' && !m.bye,
    );
    expect(losersMatches.length).toBeGreaterThan(0);
    const grandFinal = state.find((m) => m.stage === 'grand_final')!;
    expect(grandFinal.status).toBe('done');
    expect(grandFinal.teamB).toEqual(teams[0]!.playerIds);
  });

  it('carries byes through the losers bracket as walkovers', () => {
    const { teams, matches } = build('double_elim', 5);
    const byes = matches.filter((m) => m.stage === 'winners' && m.round === 1 && m.bye);
    expect(byes).toHaveLength(3);
    const played = playOut(matches, teams);
    const result = bracketResult(played, 'double_elim');
    expect(result.complete).toBe(true);
    expect(result.championIds).not.toBeNull();
  });

  it('never schedules a match against an empty slot', () => {
    for (const count of [3, 5, 6, 7, 9, 11]) {
      const { teams, matches } = build('double_elim', count);
      const played = playOut(matches, teams);
      for (const match of played) {
        if (match.status === 'done' && !match.bye) {
          expect(match.teamA.length, `${count} teams`).toBeGreaterThan(0);
          expect(match.teamB.length, `${count} teams`).toBeGreaterThan(0);
        }
      }
      expect(bracketResult(played, 'double_elim').championIds).not.toBeNull();
    }
  });
});

describe('eliminationSize', () => {
  // The preview promises how many matches actually get played. Walkovers
  // against a phantom seed are structural slots, not matches, so the bracket
  // is played out before counting.
  const playedCount = (matches: Match[]) =>
    matches.filter((m) => m.status === 'done' && !m.bye).length;

  it('predicts the single elimination match count', () => {
    for (const count of [4, 6, 8, 12, 16]) {
      resetIds();
      const teams = makeTeams(count);
      const plan = buildSingleElimination(teams, {
        thirdPlaceMatch: true,
        makeId: () => nextId('x'),
      });
      const played = playOut(resolveBracket(plan.matches.map(draftToMatch)), teams);
      expect(playedCount(played), `single ${count}`).toBe(
        eliminationSize(count, 'single_elim', true).matches,
      );
    }
  });

  it('predicts the double elimination match count', () => {
    for (const count of [4, 6, 8, 12, 16]) {
      resetIds();
      const teams = makeTeams(count);
      const plan = buildDoubleElimination(teams, {
        thirdPlaceMatch: false,
        makeId: () => nextId('y'),
      });
      const played = playOut(resolveBracket(plan.matches.map(draftToMatch)), teams);
      expect(playedCount(played), `double ${count}`).toBe(
        eliminationSize(count, 'double_elim', false).matches,
      );
    }
  });
});
