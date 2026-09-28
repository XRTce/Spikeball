import type { MatchFormat, MatchGame } from './types';

/** Game wins needed to decide a series in each format. */
export const GAMES_TO_WIN: Record<MatchFormat, number> = { bo1: 1, bo3: 2 };

/** Games won per side so far. */
export function gamesWon(games: MatchGame[]): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const game of games) {
    if (game.scoreA > game.scoreB) a += 1;
    else if (game.scoreB > game.scoreA) b += 1;
  }
  return { a, b };
}

/** Whether either side has already won enough games to decide the series. */
export function isSeriesDecided(format: MatchFormat, games: MatchGame[]): boolean {
  const need = GAMES_TO_WIN[format];
  const { a, b } = gamesWon(games);
  return a >= need || b >= need;
}
