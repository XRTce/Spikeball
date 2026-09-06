import { describe, expect, it } from 'vitest';
import { roundRobinSchedule, roundRobinSize } from '../src/domain/pairing/roundRobin';
import { suggestedSwissRounds, swissRound } from '../src/domain/pairing/swiss';
import { suggestCasualMatch } from '../src/domain/pairing/casual';
import { balancedSplit } from '../src/domain/pairing/balance';
import {
  buildHistory,
  circleMethodRounds,
  createRng,
  emptyHistory,
  minCostPairing,
  pairKey,
  GHOST,
  type PlannedMatch,
} from '../src/domain/pairing/utils';
import { buildStandings } from '../src/domain/standings';
import { replayElo } from '../src/domain/elo';
import { DEFAULT_ELO_SETTINGS } from '../src/domain/types';
import { makePlayer, makePlayers, playedMatch, plannedToMatch, resetIds, resetSequence } from './helpers';

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

function perRoundPlayers(matches: PlannedMatch[]): Map<number, string[]> {
  const byRound = new Map<number, string[]>();
  for (const match of matches) {
    const list = byRound.get(match.round) ?? [];
    list.push(...match.teamA, ...match.teamB);
    byRound.set(match.round, list);
  }
  return byRound;
}

describe('circleMethodRounds', () => {
  it('covers every pair exactly once for an even field', () => {
    const rounds = circleMethodRounds(ids(8));
    expect(rounds).toHaveLength(7);
    const seen = new Set<string>();
    for (const round of rounds) {
      expect(round).toHaveLength(4);
      for (const [a, b] of round) {
        const key = pairKey(a!, b!);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe((8 * 7) / 2);
  });

  it('adds a ghost for an odd field so exactly one player rests per round', () => {
    const rounds = circleMethodRounds(ids(5));
    expect(rounds).toHaveLength(5);
    for (const round of rounds) {
      const ghosts = round.filter((pair) => pair.includes(GHOST));
      expect(ghosts).toHaveLength(1);
    }
  });
});

describe('minCostPairing', () => {
  it('finds the optimal matching on a small set', () => {
    const values: Record<string, number> = { a: 1, b: 2, c: 10, d: 11 };
    const pairs = minCostPairing(['a', 'b', 'c', 'd'], (x, y) =>
      Math.abs(values[x]! - values[y]!),
    );
    const keys = pairs.map(([x, y]) => pairKey(x, y)).sort();
    expect(keys).toEqual([pairKey('a', 'b'), pairKey('c', 'd')].sort());
  });

  it('handles a field large enough to take the greedy path', () => {
    const items = Array.from({ length: 16 }, (_, i) => i);
    const pairs = minCostPairing(items, (x, y) => Math.abs(x - y));
    expect(pairs).toHaveLength(8);
    expect(new Set(pairs.flat())).toHaveLength(16);
  });

  it('rejects an odd number of items', () => {
    expect(() => minCostPairing([1, 2, 3], () => 0)).toThrow();
  });
});

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

  it('handles singles', () => {
    const split = balancedSplit(['a', 'b'], { ratings: { a: 1000, b: 900 }, fallbackRating: 1000 });
    expect(split.teamA).toEqual(['a']);
    expect(split.teamB).toEqual(['b']);
  });

  it('rejects an unusable player count', () => {
    expect(() => balancedSplit(['a', 'b', 'c'], { ratings: {}, fallbackRating: 1000 })).toThrow();
  });
});

describe('roundRobinSchedule (doubles)', () => {
  it('lets every player partner every other exactly once for a multiple of four', () => {
    const players = ids(8);
    const matches = roundRobinSchedule({
      playerIds: players,
      ratings: flatRatings(8),
      fallbackRating: 1000,
      teamSize: 2,
      seed: 42,
    });

    assertWellFormed(matches, 2);
    expect(matches.filter((m) => m.bye)).toHaveLength(0);
    expect(matches).toHaveLength(14);

    const partnerships = new Map<string, number>();
    for (const match of matches) {
      for (const team of [match.teamA, match.teamB]) {
        const key = pairKey(team[0]!, team[1]!);
        partnerships.set(key, (partnerships.get(key) ?? 0) + 1);
      }
    }
    expect(partnerships.size).toBe((8 * 7) / 2);
    for (const count of partnerships.values()) expect(count).toBe(1);
  });

  it('never schedules a player twice in the same round', () => {
    for (const count of [4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const matches = roundRobinSchedule({
        playerIds: ids(count),
        ratings: flatRatings(count),
        fallbackRating: 1000,
        teamSize: 2,
        seed: count,
      });
      assertWellFormed(matches, 2);
      for (const [round, players] of perRoundPlayers(matches)) {
        expect(new Set(players).size, `round ${round} of a ${count} player field`).toBe(
          players.length,
        );
      }
    }
  });

  it('spreads byes evenly when the field does not divide by four', () => {
    const players = ids(6);
    const matches = roundRobinSchedule({
      playerIds: players,
      ratings: flatRatings(6),
      fallbackRating: 1000,
      teamSize: 2,
      seed: 3,
    });

    const byes = new Map(players.map((id) => [id, 0]));
    for (const match of matches) {
      if (!match.bye) continue;
      byes.set(match.teamA[0]!, (byes.get(match.teamA[0]!) ?? 0) + 1);
    }
    const counts = [...byes.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('gives every player the same number of matches for a full field', () => {
    const players = ids(8);
    const matches = roundRobinSchedule({
      playerIds: players,
      ratings: flatRatings(8),
      fallbackRating: 1000,
      teamSize: 2,
      seed: 11,
    });
    const played = new Map(players.map((id) => [id, 0]));
    for (const match of matches) {
      for (const id of [...match.teamA, ...match.teamB]) {
        played.set(id, (played.get(id) ?? 0) + 1);
      }
    }
    expect(new Set(played.values())).toEqual(new Set([7]));
  });

  it('returns nothing for a field that cannot fill a match', () => {
    expect(
      roundRobinSchedule({
        playerIds: ids(3),
        ratings: flatRatings(3),
        fallbackRating: 1000,
        teamSize: 2,
      }),
    ).toEqual([]);
  });

  it('predicts its own size', () => {
    for (const count of [4, 6, 8, 12]) {
      const matches = roundRobinSchedule({
        playerIds: ids(count),
        ratings: flatRatings(count),
        fallbackRating: 1000,
        teamSize: 2,
        seed: 5,
      });
      const preview = roundRobinSize(count, 2);
      expect(matches.filter((m) => !m.bye)).toHaveLength(preview.matches);
      expect(new Set(matches.map((m) => m.round)).size).toBe(preview.rounds);
    }
  });
});

describe('roundRobinSchedule (singles)', () => {
  it('pairs everyone with everyone exactly once', () => {
    const matches = roundRobinSchedule({
      playerIds: ids(6),
      ratings: flatRatings(6),
      fallbackRating: 1000,
      teamSize: 1,
      seed: 9,
    });
    assertWellFormed(matches, 1);
    expect(matches.filter((m) => !m.bye)).toHaveLength(15);
    for (const [, players] of perRoundPlayers(matches)) {
      expect(new Set(players).size).toBe(players.length);
    }
  });

  it('rests one player per round for an odd field', () => {
    const matches = roundRobinSchedule({
      playerIds: ids(5),
      ratings: flatRatings(5),
      fallbackRating: 1000,
      teamSize: 1,
      seed: 9,
    });
    expect(matches.filter((m) => m.bye)).toHaveLength(5);
    expect(matches.filter((m) => !m.bye)).toHaveLength(10);
  });
});

describe('swissRound', () => {
  const history = () => emptyHistory(ids(12));

  it('pairs the whole field into quads when it divides by four', () => {
    const matches = swissRound({
      playerIds: ids(8),
      standings: [],
      ratings: flatRatings(8),
      fallbackRating: 1000,
      history: history(),
      teamSize: 2,
      round: 1,
    });
    expect(matches.filter((m) => !m.bye)).toHaveLength(2);
    expect(matches.filter((m) => m.bye)).toHaveLength(0);
    assertWellFormed(matches, 2);
  });

  it('rests the remainder and marks them as byes', () => {
    const matches = swissRound({
      playerIds: ids(10),
      standings: [],
      ratings: flatRatings(10),
      fallbackRating: 1000,
      history: history(),
      teamSize: 2,
      round: 1,
    });
    expect(matches.filter((m) => !m.bye)).toHaveLength(2);
    expect(matches.filter((m) => m.bye)).toHaveLength(2);
  });

  it('applies the Mexicano split in the first round', () => {
    const ratings: Record<string, number> = { p1: 1400, p2: 1300, p3: 1200, p4: 1100 };
    const matches = swissRound({
      playerIds: ids(4),
      standings: [],
      ratings,
      fallbackRating: 1000,
      history: emptyHistory(ids(4)),
      teamSize: 2,
      round: 1,
    });
    expect(matches).toHaveLength(1);
    expect(new Set(matches[0]!.teamA)).toEqual(new Set(['p1', 'p4']));
    expect(new Set(matches[0]!.teamB)).toEqual(new Set(['p2', 'p3']));
  });

  it('avoids repeating a partnership from an earlier round', () => {
    const h = emptyHistory(ids(4));
    h.partnered[pairKey('p1', 'p4')] = 1;
    const matches = swissRound({
      playerIds: ids(4),
      standings: [],
      ratings: { p1: 1400, p2: 1300, p3: 1200, p4: 1100 },
      fallbackRating: 1000,
      history: h,
      teamSize: 2,
      round: 2,
    });
    const partnerships = matches.flatMap((m) => [pairKey(m.teamA[0]!, m.teamA[1]!), pairKey(m.teamB[0]!, m.teamB[1]!)]);
    expect(partnerships).not.toContain(pairKey('p1', 'p4'));
  });

  it('gives the bye to whoever has rested least', () => {
    const h = emptyHistory(ids(5));
    h.byes.p5 = 2;
    const matches = swissRound({
      playerIds: ids(5),
      standings: [],
      ratings: flatRatings(5),
      fallbackRating: 1000,
      history: h,
      teamSize: 2,
      round: 3,
    });
    const bye = matches.find((m) => m.bye);
    expect(bye?.teamA[0]).not.toBe('p5');
  });

  it('ranks by standings from round two onwards', () => {
    resetIds();
    resetSequence();
    const players = makePlayers(4);
    const matches = [playedMatch(['p3', 'p4'], ['p1', 'p2'], 21, 10)];
    const replay = replayElo(players, matches, DEFAULT_ELO_SETTINGS);
    const standings = buildStandings(players, matches, replay);

    const next = swissRound({
      playerIds: ids(4),
      standings,
      ratings: replay.ratings,
      fallbackRating: 1000,
      history: buildHistory(ids(4), matches),
      teamSize: 2,
      round: 2,
    });
    // Leader partners the bottom of the table under the Mexicano rule.
    const leader = standings[0]!.playerId;
    const bottom = standings[3]!.playerId;
    const teamWithLeader = next[0]!.teamA.includes(leader) ? next[0]!.teamA : next[0]!.teamB;
    expect(teamWithLeader).toContain(bottom);
  });

  it('pairs adjacent ranks in singles and avoids rematches', () => {
    const h = emptyHistory(ids(4));
    h.faced[pairKey('p1', 'p2')] = 1;
    const matches = swissRound({
      playerIds: ids(4),
      standings: [],
      ratings: { p1: 1400, p2: 1300, p3: 1200, p4: 1100 },
      fallbackRating: 1000,
      history: h,
      teamSize: 1,
      round: 2,
    });
    assertWellFormed(matches, 1);
    expect(matches).toHaveLength(2);
    const first = matches[0]!;
    expect(pairKey(first.teamA[0]!, first.teamB[0]!)).not.toBe(pairKey('p1', 'p2'));
  });

  it('suggests a sensible number of rounds', () => {
    expect(suggestedSwissRounds(8, 2)).toBeGreaterThanOrEqual(3);
    expect(suggestedSwissRounds(24, 2)).toBeGreaterThan(suggestedSwissRounds(8, 2));
    expect(suggestedSwissRounds(200, 2)).toBeLessThanOrEqual(12);
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
      'round_robin',
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
