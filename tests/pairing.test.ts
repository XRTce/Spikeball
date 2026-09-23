import { describe, expect, it } from 'vitest';
import { suggestCasualMatch } from '../src/domain/pairing/casual';
import { balancedSplit } from '../src/domain/pairing/balance';
import {
  buildHistory,
  createRng,
  emptyHistory,
  pairKey,
  type PlannedMatch,
} from '../src/domain/pairing/utils';
import { buildStandings, compareByElo } from '../src/domain/standings';
import { replayElo } from '../src/domain/elo';
import { DEFAULT_ELO_SETTINGS } from '../src/domain/types';
import { makePlayer, playedMatch, plannedToMatch, resetIds, resetSequence } from './helpers';

const ids = (count: number) => Array.from({ length: count }, (_, i) => `p${i + 1}`);
const flatRatings = (count: number) =>
  Object.fromEntries(ids(count).map((id) => [id, 1000])) as Record<string, number>;

function assertWellFormed(matches: PlannedMatch[], teamSize: number): void {
  for (const match of matches) {
    if (match.bye) {
      expect(match.teamB).toHaveLength(0);
      expect(match.teamA.length).toBeGreaterThan(0);
      continue;
    }
    expect(match.teamA).toHaveLength(teamSize);
    expect(match.teamB).toHaveLength(teamSize);
    const everyone = [...match.teamA, ...match.teamB];
    expect(new Set(everyone).size).toBe(everyone.length);
  }
}

describe('balancedSplit', () => {
  it('produces the closest possible 2v2', () => {
    const split = balancedSplit(['a', 'b', 'c', 'd'], {
      ratings: { a: 1200, b: 800, c: 1000, d: 1000 },
      fallbackRating: 1000,
    });
    expect(split.gap).toBe(0);
    expect(new Set([...split.teamA, ...split.teamB]).size).toBe(4);
  });

  it('avoids repeating a partnership when ratings allow it', () => {
    const history = emptyHistory(['a', 'b', 'c', 'd']);
    history.partnered[pairKey('a', 'b')] = 3;
    history.partnered[pairKey('c', 'd')] = 3;
    const split = balancedSplit(['a', 'b', 'c', 'd'], {
      ratings: { a: 1000, b: 1000, c: 1000, d: 1000 },
      fallbackRating: 1000,
      history,
    });
    const partnerships = [pairKey(...(split.teamA as [string, string])), pairKey(...(split.teamB as [string, string]))];
    expect(partnerships).not.toContain(pairKey('a', 'b'));
  });

  it('rejects an unusable player count', () => {
    expect(() => balancedSplit(['a', 'b', 'c'], { ratings: {}, fallbackRating: 1000 })).toThrow();
  });

  it('excludes a split that hits the partner-repeat cap', () => {
    const history = emptyHistory(['a', 'b', 'c', 'd']);
    history.partnered[pairKey('a', 'b')] = 2;
    const split = balancedSplit(['a', 'b', 'c', 'd'], {
      ratings: { a: 1000, b: 1000, c: 1000, d: 1000 },
      fallbackRating: 1000,
      history,
      maxPartnerRepeats: 2,
    });
    const partnerships = [pairKey(...(split.teamA as [string, string])), pairKey(...(split.teamB as [string, string]))];
    expect(partnerships).not.toContain(pairKey('a', 'b'));
  });

  it('drops the cap rather than fail when every split would exceed it', () => {
    const history = emptyHistory(['a', 'b', 'c', 'd']);
    history.partnered[pairKey('a', 'b')] = 5;
    history.partnered[pairKey('a', 'c')] = 5;
    history.partnered[pairKey('a', 'd')] = 5;
    history.partnered[pairKey('b', 'c')] = 5;
    history.partnered[pairKey('b', 'd')] = 5;
    history.partnered[pairKey('c', 'd')] = 5;
    const split = balancedSplit(['a', 'b', 'c', 'd'], {
      ratings: { a: 1000, b: 1000, c: 1000, d: 1000 },
      fallbackRating: 1000,
      history,
      maxPartnerRepeats: 1,
    });
    expect(new Set([...split.teamA, ...split.teamB]).size).toBe(4);
  });
});

describe('suggestCasualMatch', () => {
  it('returns nothing when there are too few players', () => {
    expect(
      suggestCasualMatch({
        candidates: ids(3),
        ratings: flatRatings(3),
        fallbackRating: 1000,
        history: emptyHistory(ids(3)),
        teamSize: 2,
      }),
    ).toBeNull();
  });

  it('picks the four players who have played least', () => {
    const h = emptyHistory(ids(6));
    h.played.p1 = 5;
    h.played.p2 = 5;
    const suggestion = suggestCasualMatch({
      candidates: ids(6),
      ratings: flatRatings(6),
      fallbackRating: 1000,
      history: h,
      teamSize: 2,
      seed: 1,
    });
    const selected = [...suggestion!.teamA, ...suggestion!.teamB];
    expect(selected).not.toContain('p1');
    expect(selected).not.toContain('p2');
  });

  it('breaks ties by who has waited longest', () => {
    const h = emptyHistory(ids(5));
    for (const id of ids(5)) h.played[id] = 2;
    h.lastSeen.p5 = 0;
    for (const id of ['p1', 'p2', 'p3', 'p4']) h.lastSeen[id] = 10;
    const suggestion = suggestCasualMatch({
      candidates: ids(5),
      ratings: flatRatings(5),
      fallbackRating: 1000,
      history: h,
      teamSize: 2,
      seed: 1,
    });
    expect([...suggestion!.teamA, ...suggestion!.teamB]).toContain('p5');
  });

  it('balances the chosen four by rating', () => {
    const suggestion = suggestCasualMatch({
      candidates: ids(4),
      ratings: { p1: 1300, p2: 700, p3: 1000, p4: 1000 },
      fallbackRating: 1000,
      history: emptyHistory(ids(4)),
      teamSize: 2,
      seed: 1,
    });
    const teamWithTop = suggestion!.teamA.includes('p1') ? suggestion!.teamA : suggestion!.teamB;
    expect(teamWithTop).toContain('p2');
  });

  it('respects a configured maximum on repeated partnerships', () => {
    const h = emptyHistory(ids(4));
    h.partnered[pairKey('p1', 'p2')] = 2;
    const suggestion = suggestCasualMatch({
      candidates: ids(4),
      ratings: flatRatings(4),
      fallbackRating: 1000,
      history: h,
      teamSize: 2,
      seed: 1,
      maxPartnerRepeats: 2,
    });
    assertWellFormed([suggestion!], 2);
    const partnerships = [
      pairKey(suggestion!.teamA[0]!, suggestion!.teamA[1]!),
      pairKey(suggestion!.teamB[0]!, suggestion!.teamB[1]!),
    ];
    expect(partnerships).not.toContain(pairKey('p1', 'p2'));
  });
});

describe('buildHistory', () => {
  it('counts partnerships, opponents and rest from the match log', () => {
    resetIds();
    resetSequence();
    const matches = [
      playedMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15),
      playedMatch(['p1', 'p2'], ['p3', 'p4'], 21, 19),
    ];
    const history = buildHistory(ids(4), matches);
    expect(history.played.p1).toBe(2);
    expect(history.partnered[pairKey('p1', 'p2')]).toBe(2);
    expect(history.faced[pairKey('p1', 'p3')]).toBe(2);
    expect(history.faced[pairKey('p1', 'p2')]).toBeUndefined();
  });

  it('counts scheduled matches as partnerships so the planner does not repeat them', () => {
    resetIds();
    resetSequence();
    const planned = plannedToMatch(
      { round: 1, order: 0, teamA: ['p1', 'p2'], teamB: ['p3', 'p4'], bye: false },
      'winners',
    );
    const history = buildHistory(ids(4), [planned]);
    expect(history.partnered[pairKey('p1', 'p2')]).toBe(1);
    expect(history.played.p1).toBe(0);
  });
});

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(123);
    const b = createRng(123);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('buildStandings', () => {
  it('ranks by wins, then point difference', () => {
    resetIds();
    resetSequence();
    const players = [makePlayer('p1'), makePlayer('p2'), makePlayer('p3'), makePlayer('p4')];
    const matches = [
      playedMatch(['p1', 'p2'], ['p3', 'p4'], 21, 5),
      playedMatch(['p1', 'p3'], ['p2', 'p4'], 21, 19),
    ];
    const replay = replayElo(players, matches, DEFAULT_ELO_SETTINGS);
    const standings = buildStandings(players, matches, replay);

    expect(standings[0]!.playerId).toBe('p1');
    expect(standings[0]!.wins).toBe(2);
    expect(standings[0]!.played).toBe(2);
    expect(standings[3]!.playerId).toBe('p4');
    expect(standings[3]!.losses).toBe(2);
    expect(standings[0]!.form).toEqual([true, true]);
  });
});

describe('compareByElo', () => {
  it('orders the leaderboard by rating, not by wins', () => {
    resetIds();
    resetSequence();
    // p5 starts far ahead and wins only once; p1 wins twice from a low start.
    const players = [
      makePlayer('p1', 900),
      makePlayer('p2', 900),
      makePlayer('p3', 1000),
      makePlayer('p4', 1000),
      makePlayer('p5', 1400),
      makePlayer('p6', 1000),
    ];
    const matches = [
      playedMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15),
      playedMatch(['p1', 'p3'], ['p2', 'p4'], 21, 17),
      playedMatch(['p5', 'p4'], ['p2', 'p3'], 21, 12),
    ];
    const replay = replayElo(players, matches, DEFAULT_ELO_SETTINGS);
    const standings = buildStandings(players, matches, replay).sort(compareByElo);

    const played = standings.filter((row) => row.played > 0);
    for (let i = 1; i < played.length; i += 1) {
      expect(played[i - 1]!.elo).toBeGreaterThanOrEqual(played[i]!.elo);
    }
    expect(standings[0]!.playerId).toBe('p5');
    expect(standings[0]!.wins).toBeLessThan(standings.find((row) => row.playerId === 'p1')!.wins);
  });

  it('keeps players without a match below everyone who has played', () => {
    resetIds();
    resetSequence();
    const players = [makePlayer('p1'), makePlayer('p2'), makePlayer('p3'), makePlayer('p4'), makePlayer('p5', 2000)];
    const matches = [playedMatch(['p1', 'p2'], ['p3', 'p4'], 21, 5)];
    const replay = replayElo(players, matches, DEFAULT_ELO_SETTINGS);
    const standings = buildStandings(players, matches, replay).sort(compareByElo);

    expect(standings.at(-1)!.playerId).toBe('p5');
  });
});
