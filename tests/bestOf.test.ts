import { describe, expect, it } from 'vitest';
import {
  MAX_GAMES,
  defaultGameIndex,
  gamesWon,
  isSeriesDecided,
  recordGame,
  withBestOfFields,
  type SeriesState,
} from '../src/domain/bestOf';
import type { MatchFormat, MatchGame } from '../src/domain/types';

const A = { scoreA: 21, scoreB: 15 };
const B = { scoreA: 17, scoreB: 21 };

function open(format: MatchFormat, games: MatchGame[] = []): SeriesState {
  return { format, games, status: 'scheduled' };
}

function done(format: MatchFormat, games: MatchGame[]): SeriesState {
  return { format, games, status: 'done' };
}

/** Deterministic pseudo-random sequence, so a failing property is reproducible. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

describe('gamesWon / isSeriesDecided', () => {
  it('counts game wins per side', () => {
    expect(gamesWon([A, B, A])).toEqual({ a: 2, b: 1 });
    expect(isSeriesDecided('bo3', [A, B])).toBe(false);
    expect(isSeriesDecided('bo3', [A, B, A])).toBe(true);
    expect(isSeriesDecided('bo1', [B])).toBe(true);
  });
});

describe('recordGame', () => {
  it('decides a bo1 with its one game and keeps the real points as the score', () => {
    expect(recordGame(open('bo1'), 0, 21, 18)).toEqual({
      games: [{ scoreA: 21, scoreB: 18 }],
      decided: true,
      scoreA: 21,
      scoreB: 18,
    });
  });

  it('keeps a bo3 open until a side has two wins, then scores it as the tally', () => {
    const first = recordGame(open('bo3'), 0, 21, 15);
    expect(first).toMatchObject({ decided: false, scoreA: null, scoreB: null });

    const second = recordGame(open('bo3', first.games), 1, 15, 21);
    expect(second).toMatchObject({ decided: false, games: [A, { scoreA: 15, scoreB: 21 }] });

    const third = recordGame(open('bo3', second.games), 2, 21, 19);
    expect(third).toMatchObject({ decided: true, scoreA: 2, scoreB: 1 });
  });

  it('never appends to a decided series - a new score corrects its last game', () => {
    const outcome = recordGame(done('bo3', [A, A]), 2, 21, 10);
    expect(outcome.games).toEqual([A, { scoreA: 21, scoreB: 10 }]);
    expect(outcome.decided).toBe(true);
  });

  it('reopens the series when a correction undoes the deciding win', () => {
    const outcome = recordGame(done('bo3', [A, A]), 1, 15, 21);
    expect(outcome).toEqual({ games: [A, { scoreA: 15, scoreB: 21 }], decided: false, scoreA: null, scoreB: null });
  });

  it('drops the games after a correction that decides the series earlier', () => {
    // 2:1 for A; game 2 was actually A's too, so game 3 was never played.
    const outcome = recordGame(done('bo3', [A, B, A]), 1, 21, 12);
    expect(outcome.games).toEqual([A, { scoreA: 21, scoreB: 12 }]);
    expect(outcome).toMatchObject({ decided: true, scoreA: 2, scoreB: 0 });
  });

  it('corrects an earlier game of a series that is still open', () => {
    const outcome = recordGame(open('bo3', [B]), 0, 21, 19);
    expect(outcome.games).toEqual([{ scoreA: 21, scoreB: 19 }]);
    expect(outcome.decided).toBe(false);
  });

  it('holds its invariants for any sequence of entries and corrections', () => {
    const random = lcg(7);
    for (let run = 0; run < 300; run += 1) {
      const format: MatchFormat = random() < 0.5 ? 'bo1' : 'bo3';
      let state: SeriesState = open(format);
      for (let step = 0; step < 8; step += 1) {
        const index = Math.floor(random() * (MAX_GAMES[format] + 2)) - 1;
        const aWins = random() < 0.5;
        const outcome = recordGame(state, index, aWins ? 21 : 12, aWins ? 12 : 21);

        expect(outcome.games.length).toBeGreaterThan(0);
        expect(outcome.games.length).toBeLessThanOrEqual(MAX_GAMES[format]);
        // No game after the one that decided the series.
        for (let i = 1; i < outcome.games.length; i += 1) {
          expect(isSeriesDecided(format, outcome.games.slice(0, i))).toBe(false);
        }
        expect(outcome.decided).toBe(isSeriesDecided(format, outcome.games));
        if (outcome.decided && format === 'bo3') {
          const wins = gamesWon(outcome.games);
          expect([outcome.scoreA, outcome.scoreB]).toEqual([wins.a, wins.b]);
        }
        if (!outcome.decided) expect([outcome.scoreA, outcome.scoreB]).toEqual([null, null]);

        state = { format, games: outcome.games, status: outcome.decided ? 'done' : 'scheduled' };
      }
    }
  });
});

describe('defaultGameIndex', () => {
  it('points at the next game of an open series and the last game of a decided one', () => {
    expect(defaultGameIndex(open('bo3'))).toBe(0);
    expect(defaultGameIndex(open('bo3', [A]))).toBe(1);
    expect(defaultGameIndex(done('bo3', [A, B, A]))).toBe(2);
    expect(defaultGameIndex(done('bo1', [A]))).toBe(0);
  });
});

describe('withBestOfFields', () => {
  it('turns a finished pre-bo3 row into a bo1 whose one game is its score', () => {
    const row = withBestOfFields({ id: 'm1', status: 'done', scoreA: 21, scoreB: 9 });
    expect(row).toMatchObject({ format: 'bo1', games: [{ scoreA: 21, scoreB: 9 }] });
  });

  it('gives an unplayed or bye row an empty game log', () => {
    expect(withBestOfFields({ status: 'scheduled', scoreA: null, scoreB: null }).games).toEqual([]);
    expect(withBestOfFields({ status: 'done', bye: true, scoreA: null, scoreB: null }).games).toEqual([]);
  });

  it('keeps the format and games of a current row untouched', () => {
    const current = { format: 'bo3', status: 'done', scoreA: 2, scoreB: 0, games: [A, A] };
    expect(withBestOfFields(current)).toEqual(current);
  });

  it('repairs a result written by a client that predates bo3 (score set, games left empty)', () => {
    const row = withBestOfFields({ format: 'bo1', status: 'done', scoreA: 21, scoreB: 19, games: [] });
    expect(row.games).toEqual([{ scoreA: 21, scoreB: 19 }]);
  });

  it('repairs a result cleared by a client that predates bo3 (score reset, games left behind)', () => {
    const cleared = { status: 'scheduled', scoreA: null, scoreB: null };
    expect(withBestOfFields({ ...cleared, format: 'bo1', games: [A] }).games).toEqual([]);
    expect(withBestOfFields({ ...cleared, format: 'bo3', games: [A, A] }).games).toEqual([]);
    // A running series is legitimately not finished - left alone.
    expect(withBestOfFields({ ...cleared, format: 'bo3', games: [A, B] }).games).toEqual([A, B]);
  });
});
