import { describe, expect, it } from 'vitest';
import { buildStandings, compareByKey, statsFor } from '../src/domain/standings';
import { replayElo } from '../src/domain/elo';
import { DEFAULT_ELO_SETTINGS } from '../src/domain/types';
import type { StandingRow } from '../src/domain/types';
import { makePlayers, playedMatch, resetSequence } from './helpers';

function row(name: string, patch: Partial<StandingRow> = {}): StandingRow {
  return {
    playerId: name,
    name,
    played: 1,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDiff: 0,
    winRate: 0,
    byFormat: { bo1: { played: 0, wins: 0 }, bo3: { played: 0, wins: 0 } },
    elo: 1000,
    baseElo: 1000,
    eloChange: 0,
    form: [],
    ...patch,
  };
}

const order = (key: Parameters<typeof compareByKey>[0], rows: StandingRow[]) =>
  [...rows].sort(compareByKey(key)).map((r) => r.name);

describe('compareByKey', () => {
  const rows = [
    row('Cara', { elo: 1100, wins: 1, played: 3, winRate: 1 / 3, pointDiff: -2 }),
    row('Ben', { elo: 1050, wins: 3, played: 3, winRate: 1, pointDiff: 9 }),
    row('Ana', { elo: 1000, wins: 2, played: 4, winRate: 0.5, pointDiff: 4 }),
    row('Dora', { elo: 1200, wins: 0, played: 0 }),
  ];

  it('sorts by elo with unplayed players last', () => {
    expect(order('elo', rows)).toEqual(['Cara', 'Ben', 'Ana', 'Dora']);
  });

  it('sorts numeric keys high to low', () => {
    expect(order('wins', rows)).toEqual(['Ben', 'Ana', 'Cara', 'Dora']);
    expect(order('played', rows)).toEqual(['Ana', 'Cara', 'Ben', 'Dora']);
    expect(order('winRate', rows)).toEqual(['Ben', 'Ana', 'Cara', 'Dora']);
  });

  it('breaks ties by elo', () => {
    const tied = [row('A', { wins: 2, elo: 1000 }), row('B', { wins: 2, elo: 1100 })];
    expect(order('wins', tied)).toEqual(['B', 'A']);
  });

  it('sorts names A to Z', () => {
    expect(order('name', rows)).toEqual(['Ana', 'Ben', 'Cara', 'Dora']);
  });

  it('sorts played, wins and win rate by the chosen format view', () => {
    const byFormat = [
      row('Ana', { elo: 1000, byFormat: { bo1: { played: 3, wins: 3 }, bo3: { played: 0, wins: 0 } } }),
      row('Ben', { elo: 1100, byFormat: { bo1: { played: 0, wins: 0 }, bo3: { played: 2, wins: 2 } } }),
      row('Cara', { elo: 1050, byFormat: { bo1: { played: 1, wins: 0 }, bo3: { played: 4, wins: 1 } } }),
    ];
    const sorted = (view: 'bo1' | 'bo3', key: 'played' | 'wins' | 'winRate') =>
      [...byFormat].sort(compareByKey(key, view)).map((r) => r.name);
    // Ben never played a bo1, so he sits below Cara's lost one despite his rating.
    expect(sorted('bo1', 'wins')).toEqual(['Ana', 'Cara', 'Ben']);
    expect(sorted('bo3', 'wins')).toEqual(['Ben', 'Cara', 'Ana']);
    expect(sorted('bo3', 'played')).toEqual(['Cara', 'Ben', 'Ana']);
    expect(sorted('bo3', 'winRate')).toEqual(['Ben', 'Cara', 'Ana']);
  });

  it('puts players without a match in the format view last, whatever their rating', () => {
    const view = [
      row('Loser', { elo: 900, byFormat: { bo1: { played: 0, wins: 0 }, bo3: { played: 2, wins: 0 } } }),
      row('Unplayed', { elo: 1300, byFormat: { bo1: { played: 4, wins: 4 }, bo3: { played: 0, wins: 0 } } }),
      row('Winner', { elo: 1000, byFormat: { bo1: { played: 0, wins: 0 }, bo3: { played: 1, wins: 1 } } }),
    ];
    for (const key of ['played', 'wins', 'winRate'] as const) {
      expect([...view].sort(compareByKey(key, 'bo3')).map((r) => r.name).at(-1)).toBe('Unplayed');
    }
  });
});

describe('statsFor', () => {
  const r = row('Ana', {
    played: 5,
    wins: 4,
    winRate: 0.8,
    byFormat: { bo1: { played: 3, wins: 3 }, bo3: { played: 2, wins: 1 } },
  });

  it('returns the overall numbers for the all view', () => {
    expect(statsFor(r, 'all')).toEqual({ played: 5, wins: 4, winRate: 0.8 });
  });

  it('splits bo1 and bo3', () => {
    expect(statsFor(r, 'bo1')).toEqual({ played: 3, wins: 3, winRate: 1 });
    expect(statsFor(r, 'bo3')).toEqual({ played: 2, wins: 1, winRate: 0.5 });
  });

  it('has a zero win rate without matches in the format', () => {
    expect(statsFor(row('Ben'), 'bo3').winRate).toBe(0);
  });
});

describe('buildStandings per format', () => {
  it('counts bo1 matches and bo3 series separately', () => {
    resetSequence();
    const players = makePlayers(4);
    const team = ['p1', 'p2'];
    const other = ['p3', 'p4'];
    const bo1 = (won: boolean) =>
      playedMatch(team, other, won ? 21 : 15, won ? 15 : 21, { format: 'bo1' });
    const bo3 = (won: boolean) => {
      const games = won
        ? [{ scoreA: 21, scoreB: 10 }, { scoreA: 21, scoreB: 12 }]
        : [{ scoreA: 10, scoreB: 21 }, { scoreA: 12, scoreB: 21 }];
      return playedMatch(team, other, won ? 2 : 0, won ? 0 : 2, { format: 'bo3', games });
    };
    const matches = [bo1(true), bo1(true), bo1(true), bo3(true), bo3(false)];
    const replay = replayElo(players, matches, DEFAULT_ELO_SETTINGS);
    const p1 = buildStandings(players, matches, replay).find((r) => r.playerId === 'p1')!;

    expect(p1.byFormat).toEqual({ bo1: { played: 3, wins: 3 }, bo3: { played: 2, wins: 1 } });
    expect(p1.played).toBe(5);
    expect(p1.wins).toBe(4);
  });
});
