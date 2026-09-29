import { describe, expect, it } from 'vitest';
import {
  computeMatchDeltas,
  eloSeries,
  expectedScore,
  kFactorFor,
  marginMultiplier,
  replayElo,
  roundDelta,
  teamRating,
} from '../src/domain/elo';
import { DEFAULT_ELO_SETTINGS, type EloSettings } from '../src/domain/types';
import { makeMatch, makePlayer, makePlayers, playedMatch, resetIds, resetSequence } from './helpers';

const flatSettings: EloSettings = {
  ...DEFAULT_ELO_SETTINGS,
  useMarginOfVictory: false,
  kFactorProvisional: DEFAULT_ELO_SETTINGS.kFactor,
};

describe('expectedScore', () => {
  it('is even for equal ratings', () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
  });

  it('matches the reference value for a 200 point gap', () => {
    expect(expectedScore(1200, 1000)).toBeCloseTo(0.7597, 4);
    expect(expectedScore(1000, 1200)).toBeCloseTo(0.2403, 4);
  });

  it('is complementary', () => {
    expect(expectedScore(1345, 987) + expectedScore(987, 1345)).toBeCloseTo(1, 10);
  });
});

describe('teamRating', () => {
  it('averages the members', () => {
    expect(teamRating([1000, 1200])).toBe(1100);
    expect(teamRating([])).toBe(0);
  });
});

describe('roundDelta', () => {
  it('rounds halves away from zero so wins and losses mirror', () => {
    expect(roundDelta(12.5)).toBe(13);
    expect(roundDelta(-12.5)).toBe(-13);
    expect(roundDelta(0)).toBe(0);
  });
});

describe('kFactorFor', () => {
  it('uses the provisional K until the threshold is reached', () => {
    expect(kFactorFor(0, DEFAULT_ELO_SETTINGS)).toBe(40);
    expect(kFactorFor(7, DEFAULT_ELO_SETTINGS)).toBe(40);
    expect(kFactorFor(8, DEFAULT_ELO_SETTINGS)).toBe(24);
    expect(kFactorFor(99, DEFAULT_ELO_SETTINGS)).toBe(24);
  });
});

describe('marginMultiplier', () => {
  it('is 1 for a one point margin and grows with the margin', () => {
    expect(marginMultiplier(1, 0)).toBeCloseTo(Math.log(2), 6);
    expect(marginMultiplier(15, 0)).toBeGreaterThan(marginMultiplier(2, 0));
  });

  it('damps blowouts by the favourite', () => {
    const underdog = marginMultiplier(15, -300);
    const favourite = marginMultiplier(15, 300);
    expect(underdog).toBeGreaterThan(favourite);
  });
});

describe('computeMatchDeltas', () => {
  const ratings = { a: 1000, b: 1000, c: 1000, d: 1000 };
  const gamesPlayed = { a: 20, b: 20, c: 20, d: 20 };

  it('splits half the K-factor on an even 2v2', () => {
    const deltas = computeMatchDeltas({
      teamA: ['a', 'b'],
      teamB: ['c', 'd'],
      scoreA: 21,
      scoreB: 15,
      ratings,
      gamesPlayed,
      settings: flatSettings,
    });
    expect(deltas.a).toBe(12);
    expect(deltas.b).toBe(12);
    expect(deltas.c).toBe(-12);
    expect(deltas.d).toBe(-12);
  });

  it('is zero-sum when both teams share the same K', () => {
    const deltas = computeMatchDeltas({
      teamA: ['a', 'b'],
      teamB: ['c', 'd'],
      scoreA: 21,
      scoreB: 9,
      ratings: { a: 1200, b: 1150, c: 900, d: 980 },
      gamesPlayed,
      settings: flatSettings,
    });
    const sum = Object.values(deltas).reduce((total, value) => total + value, 0);
    expect(sum).toBe(0);
  });

  it('rewards beating a stronger team more than beating a weaker one', () => {
    const upset = computeMatchDeltas({
      teamA: ['a', 'b'],
      teamB: ['c', 'd'],
      scoreA: 21,
      scoreB: 19,
      ratings: { a: 900, b: 900, c: 1300, d: 1300 },
      gamesPlayed,
      settings: flatSettings,
    });
    const expected = computeMatchDeltas({
      teamA: ['a', 'b'],
      teamB: ['c', 'd'],
      scoreA: 21,
      scoreB: 19,
      ratings: { a: 1300, b: 1300, c: 900, d: 900 },
      gamesPlayed,
      settings: flatSettings,
    });
    expect(upset.a!).toBeGreaterThan(expected.a!);
  });

  it('gives provisional players a bigger swing than settled ones', () => {
    const deltas = computeMatchDeltas({
      teamA: ['a', 'b'],
      teamB: ['c', 'd'],
      scoreA: 21,
      scoreB: 12,
      ratings,
      gamesPlayed: { a: 0, b: 30, c: 30, d: 30 },
      settings: { ...DEFAULT_ELO_SETTINGS, useMarginOfVictory: false },
    });
    expect(deltas.a).toBe(20);
    expect(deltas.b).toBe(12);
  });

  it('supports singles', () => {
    const deltas = computeMatchDeltas({
      teamA: ['a'],
      teamB: ['c'],
      scoreA: 21,
      scoreB: 10,
      ratings,
      gamesPlayed,
      settings: flatSettings,
    });
    expect(deltas.a).toBe(12);
    expect(deltas.c).toBe(-12);
  });
});

describe('replayElo', () => {
  it('applies results in sequence and records history', () => {
    resetIds();
    resetSequence();
    const players = makePlayers(4);
    const matches = [
      playedMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15),
      playedMatch(['p1', 'p3'], ['p2', 'p4'], 21, 18),
    ];
    const replay = replayElo(players, matches, flatSettings);

    expect(replay.gamesPlayed.p1).toBe(2);
    expect(replay.ratings.p1).toBeGreaterThan(1000);
    expect(replay.ratings.p4).toBeLessThan(1000);
    // Base seed point plus one point per player per match.
    expect(replay.history).toHaveLength(4 + 8);
    expect(Object.keys(replay.perMatch)).toHaveLength(2);
  });

  it('ignores byes, scheduled matches and unknown players', () => {
    resetIds();
    resetSequence();
    const players = makePlayers(4);
    const matches = [
      playedMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15),
      makeBye(),
      playedMatch(['p1', 'p2'], ['p3', 'ghost'], 21, 4),
    ];
    const replay = replayElo(players, matches, flatSettings);
    expect(replay.gamesPlayed.p1).toBe(1);
  });

  it('is independent of the order the match log is stored in', () => {
    resetIds();
    resetSequence();
    const players = makePlayers(4);
    const matches = [
      playedMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15),
      playedMatch(['p1', 'p3'], ['p2', 'p4'], 21, 18),
      playedMatch(['p1', 'p4'], ['p2', 'p3'], 12, 21),
    ];
    const forward = replayElo(players, matches, DEFAULT_ELO_SETTINGS).ratings;
    const shuffled = replayElo(players, [...matches].reverse(), DEFAULT_ELO_SETTINGS).ratings;
    expect(shuffled).toEqual(forward);
  });

  it('fully reverses a deleted result', () => {
    resetIds();
    resetSequence();
    const players = makePlayers(4);
    const first = playedMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15);
    const second = playedMatch(['p1', 'p3'], ['p2', 'p4'], 21, 18);

    const before = replayElo(players, [first], DEFAULT_ELO_SETTINGS).ratings;
    const after = replayElo(players, [first, second], DEFAULT_ELO_SETTINGS).ratings;
    expect(after).not.toEqual(before);

    const removed = replayElo(players, [first], DEFAULT_ELO_SETTINGS).ratings;
    expect(removed).toEqual(before);
  });

  it('rates a bo3 game by game, giving it more total weight than a bo1', () => {
    resetIds();
    resetSequence();
    const bo1Players = makePlayers(4);
    const bo1 = playedMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15, { format: 'bo1' });
    const bo1Replay = replayElo(bo1Players, [bo1], flatSettings);

    resetIds();
    resetSequence();
    const bo3Players = makePlayers(4);
    const bo3 = playedMatch(['p1', 'p2'], ['p3', 'p4'], 2, 0, {
      format: 'bo3',
      games: [
        { scoreA: 21, scoreB: 15 },
        { scoreA: 21, scoreB: 17 },
      ],
    });
    const bo3Replay = replayElo(bo3Players, [bo3], flatSettings);

    // Every game is its own rated event.
    expect(bo3Replay.gamesPlayed.p1).toBe(2);
    expect(bo1Replay.gamesPlayed.p1).toBe(1);
    // perMatch still reports one aggregate entry per match, summed over its games.
    expect(Object.keys(bo3Replay.perMatch)).toHaveLength(1);
    expect(bo3Replay.perMatch[bo3.id]!.delta.p1).toBe(bo3Replay.ratings.p1! - 1000);
    // A straight 2-0 bo3 sweep moves ratings by more than a single bo1 game
    // of the same first-game margin, because the second win is its own event.
    expect(bo3Replay.ratings.p1! - 1000).toBeGreaterThan(bo1Replay.ratings.p1! - 1000);
  });

  it('already moves ratings after the first game of an undecided bo3', () => {
    resetIds();
    resetSequence();
    const players = makePlayers(4);
    const inProgress = makeMatch({
      teamA: ['p1', 'p2'],
      teamB: ['p3', 'p4'],
      format: 'bo3',
      status: 'scheduled',
      games: [{ scoreA: 21, scoreB: 15 }],
    });
    const replay = replayElo(players, [inProgress], flatSettings);
    expect(replay.gamesPlayed.p1).toBe(1);
    expect(replay.ratings.p1).toBeGreaterThan(1000);
  });

  it('starts every player from their own base rating', () => {
    resetIds();
    resetSequence();
    const players = [
      makePlayer('p1', 1200),
      makePlayer('p2', 900),
      makePlayer('p3', 1000),
      makePlayer('p4', 1000),
    ];
    const replay = replayElo(players, [], DEFAULT_ELO_SETTINGS);
    expect(replay.ratings).toEqual({ p1: 1200, p2: 900, p3: 1000, p4: 1000 });
  });
});

describe('eloSeries', () => {
  it('starts at the base rating and adds one point per match', () => {
    resetIds();
    resetSequence();
    const players = makePlayers(4);
    const matches = [
      playedMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15),
      playedMatch(['p1', 'p3'], ['p2', 'p4'], 21, 18),
    ];
    const replay = replayElo(players, matches, flatSettings);
    const series = eloSeries(replay, ['p1']);
    expect(series.p1).toHaveLength(3);
    expect(series.p1![0]).toBe(1000);
  });
});

function makeBye() {
  return playedMatch(['p1'], [], 0, 0, { bye: true });
}
