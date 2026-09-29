import type { Match, MatchFormat, MatchGame, MatchStatus } from './types';

/** Game wins needed to decide a series in each format. */
export const GAMES_TO_WIN: Record<MatchFormat, number> = { bo1: 1, bo3: 2 };

/** The most games a series in each format can take. */
export const MAX_GAMES: Record<MatchFormat, number> = { bo1: 1, bo3: 3 };

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

/** The parts of a match that the series rules read. */
export interface SeriesState {
  format: MatchFormat;
  games: MatchGame[];
  status: MatchStatus;
}

/**
 * A match after a game was recorded. Once decided, `scoreA`/`scoreB` are its
 * top-level score: a bo1 keeps its one game's points, a bo3 the games won
 * per side (2:1).
 */
export type SeriesOutcome =
  | { games: MatchGame[]; decided: true; scoreA: number; scoreB: number }
  | { games: MatchGame[]; decided: false; scoreA: null; scoreB: null };

/**
 * Where a new score goes by default: the next game of an open series, or the
 * last game of a decided one, which is then being corrected.
 */
export function defaultGameIndex(match: SeriesState): number {
  return match.status === 'done' && match.games.length > 0
    ? match.games.length - 1
    : match.games.length;
}

/** Cuts the log after the game that decided the series. */
function truncateAtDecision(format: MatchFormat, games: MatchGame[]): MatchGame[] {
  const need = GAMES_TO_WIN[format];
  let a = 0;
  let b = 0;
  for (let i = 0; i < games.length; i += 1) {
    const game = games[i]!;
    if (game.scoreA > game.scoreB) a += 1;
    else if (game.scoreB > game.scoreA) b += 1;
    if (a >= need || b >= need) return games.slice(0, i + 1);
  }
  return games;
}

/**
 * Records one game score into a match's series - the single rule both the
 * repository and the result screen apply, so the screen's prediction of
 * "does this finish the match?" can never disagree with what gets stored.
 *
 * `index` is an existing game to correct, or `games.length` for the next
 * one; a decided series takes no further game, so an index past its end
 * corrects the last game instead. A correction that decides the series
 * earlier drops the games after it - they could not have been played - and
 * one that undoes the deciding win reopens the series.
 */
export function recordGame(
  match: SeriesState,
  index: number,
  scoreA: number,
  scoreB: number,
): SeriesOutcome {
  const lastIndex = isSeriesDecided(match.format, match.games)
    ? match.games.length - 1
    : match.games.length;
  const at = Math.max(0, Math.min(index, lastIndex));

  const edited = [...match.games];
  edited[at] = { scoreA, scoreB };
  const games = truncateAtDecision(match.format, edited);
  const decided = isSeriesDecided(match.format, games);

  if (!decided) return { games, decided: false, scoreA: null, scoreB: null };
  if (match.format === 'bo3') {
    const wins = gamesWon(games);
    return { games, decided: true, scoreA: wins.a, scoreB: wins.b };
  }
  return { games, decided: true, scoreA: games[0]!.scoreA, scoreB: games[0]!.scoreB };
}

/**
 * `format` and `games` arrived with bo1/bo3 support. A match row written
 * before it - in a device's IndexedDB, an old backup file, or a snapshot the
 * sync server stored before the update (or received from a client that has
 * not updated yet) - is a bo1 whose one game is its recorded score.
 *
 * A client that has not updated yet also edits current rows without knowing
 * about `games`, which leaves two tell-tale states behind, repaired here:
 * a finished row with an empty game log (it entered a score), and a row that
 * is not finished although its games decide the series (it cleared one).
 */
export function withBestOfFields<T extends object>(raw: T): T & Pick<Match, 'format' | 'games'> {
  const row = raw as Record<string, unknown>;
  const format = (row.format as MatchFormat | undefined) ?? 'bo1';
  let games = Array.isArray(row.games) ? (row.games as MatchGame[]) : [];
  if (games.length === 0 && row.status === 'done') {
    if (typeof row.scoreA === 'number' && typeof row.scoreB === 'number') {
      games = [{ scoreA: row.scoreA, scoreB: row.scoreB }];
    }
  } else if (row.status !== 'done' && isSeriesDecided(format, games)) {
    games = [];
  }
  return { ...raw, format, games };
}
