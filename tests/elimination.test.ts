import { describe, expect, it } from 'vitest';
import {
  bracketResult,
  buildSingleElimination,
  eliminationSize,
  nextPowerOfTwo,
  resolveBracket,
  seedOrder,
  seedTeams,
  supportsThirdPlace,
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

function build(teamCount: number, thirdPlace = false) {
  resetIds();
  resetSequence();
  const teams = makeTeams(teamCount);
  const plan = buildSingleElimination(teams, { thirdPlaceMatch: thirdPlace, makeId: () => nextId('bm') });
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

describe('seedTeams', () => {
  it('seeds drafted pairs by combined rating, strongest first', () => {
    resetIds();
    const teams = seedTeams(
      [{ playerIds: ['c', 'd'] }, { playerIds: ['a', 'b'] }, { playerIds: ['e', 'f'] }],
      { a: 1400, b: 1300, c: 1100, d: 900, e: 1200 },
      1000,
      (id) => id.toUpperCase(),
      () => nextId('t'),
    );
    // e (1200) with f (fallback 1000) averages 1100, between a+b (1350) and c+d (1000).
    expect(teams.map((team) => team.playerIds.join(''))).toEqual(['ab', 'ef', 'cd']);
    expect(teams.map((team) => team.seed)).toEqual([1, 2, 3]);
    expect(teams[0]!.name).toBe('A & B');
  });
});

describe('single elimination', () => {
  it('creates n-1 matches for a full bracket', () => {
    const { matches } = build(8);
    expect(matches).toHaveLength(7);
    expect(matches.filter((m) => m.round === 1)).toHaveLength(4);
    expect(matches.filter((m) => m.round === 3)).toHaveLength(1);
  });

  it('adds a third place match when requested', () => {
    const { matches } = build(8, true);
    expect(matches).toHaveLength(8);
    expect(matches.filter((m) => m.stage === 'third_place')).toHaveLength(1);
  });

  it('does not add a third place match with fewer than 4 teams', () => {
    for (const count of [2, 3]) {
      const { matches } = build(count, true);
      expect(matches.filter((m) => m.stage === 'third_place'), `${count} teams`).toHaveLength(0);
    }
  });

  it('adds the third place match exactly when supportsThirdPlace allows it', () => {
    expect(supportsThirdPlace(3)).toBe(false);
    expect(supportsThirdPlace(4)).toBe(true);
    for (let count = 2; count <= 9; count += 1) {
      const { matches } = build(count, true);
      const thirds = matches.filter((m) => m.stage === 'third_place').length;
      expect(thirds, `${count} teams`).toBe(supportsThirdPlace(count) ? 1 : 0);
    }
  });

  it('walks byes straight into round two', () => {
    const { matches } = build(6);
    const firstRound = matches.filter((m) => m.round === 1);
    expect(firstRound.filter((m) => m.bye)).toHaveLength(2);

    const secondRound = matches.filter((m) => m.round === 2);
    // Seeds 1 and 2 had byes, so both are already standing in the semi finals.
    const advanced = secondRound.flatMap((m) => [...m.teamA, ...m.teamB]);
    expect(advanced).toContain('p1');
    expect(advanced).toContain('p3');
  });

  it('lets the top seed win when there are no upsets', () => {
    const { teams, matches } = build(8, true);
    const played = playOut(matches, teams);
    const result = bracketResult(played);
    expect(result.complete).toBe(true);
    expect(result.championIds).toEqual(teams[0]!.playerIds);
    expect(result.runnerUpIds).toEqual(teams[1]!.playerIds);
    expect(result.thirdIds).not.toBeNull();
  });

  it('reports the podium from the bracket, not the table', () => {
    const { teams, matches } = build(4, true);
    const final = matches.find((m) => m.round === 2 && m.stage === 'winners')!;
    const semisPlayed = playOut(matches, teams, {});
    const result = bracketResult(semisPlayed);
    expect(result.championIds).toEqual(teams[0]!.playerIds);
    expect(final).toBeDefined();
  });

  it('re-resolves the whole bracket when an early result is corrected', () => {
    const { teams, matches } = build(4);
    const semi = matches.find((m) => m.round === 1 && m.order === 0)!;

    let state = resolveBracket(recordResult(matches, semi.id, 21, 10));
    let final = state.find((m) => m.round === 2)!;
    expect(final.teamA).toEqual(teams[0]!.playerIds);

    state = resolveBracket(recordResult(state, semi.id, 10, 21));
    final = state.find((m) => m.round === 2)!;
    expect(final.teamA).toEqual(teams[3]!.playerIds);
  });

  it('discards a downstream score that no longer belongs to the teams standing there', () => {
    const { matches } = build(4);
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

describe('eliminationSize', () => {
  // The preview promises how many matches actually get played. Walkovers
  // against a phantom seed are structural slots, not matches, so the bracket
  // is played out before counting.
  const playedCount = (matches: Match[]) =>
    matches.filter((m) => m.status === 'done' && !m.bye).length;

  it('predicts the match count', () => {
    for (const count of [2, 3, 4, 5, 6, 8, 12, 16]) {
      resetIds();
      const teams = makeTeams(count);
      const plan = buildSingleElimination(teams, {
        thirdPlaceMatch: true,
        makeId: () => nextId('x'),
      });
      const played = playOut(resolveBracket(plan.matches.map(draftToMatch)), teams);
      expect(playedCount(played), `single ${count}`).toBe(eliminationSize(count, true).matches);
    }
  });
});
