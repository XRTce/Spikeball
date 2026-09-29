import type { EloSettings, Match, Player } from './types';

/**
 * Elo for roundnet.
 *
 * Roundnet is played 2v2 with rotating partners, so ratings are kept per
 * player and a team is represented by the arithmetic mean of its members'
 * ratings - the standard "team = average rating" extension of Elo used by most
 * team ladders. Every member of a team receives the same result-based delta,
 * scaled by that player's own K-factor.
 *
 * References:
 *  - A. Elo, "The Rating of Chessplayers, Past and Present" (1978)
 *  - FIDE tiered K-factor (higher K while a rating is provisional)
 *  - FiveThirtyEight's margin-of-victory multiplier, which corrects the
 *    autocorrelation between margin and pre-match rating gap
 */

/** Probability that A beats B given both ratings. */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function teamRating(ratings: number[]): number {
  if (ratings.length === 0) return 0;
  return ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
}

/**
 * Margin-of-victory multiplier. Grows logarithmically with the point margin
 * and shrinks when a strong team was already expected to win, which stops
 * blowouts by favourites from inflating ratings.
 */
export function marginMultiplier(pointMargin: number, winnerRatingEdge: number): number {
  const margin = Math.abs(pointMargin);
  if (margin === 0) return 1;
  return Math.log(margin + 1) * (2.2 / (winnerRatingEdge * 0.001 + 2.2));
}

/** Rounds halves away from zero so a win and the mirrored loss stay symmetric. */
export function roundDelta(value: number): number {
  return value >= 0 ? Math.floor(value + 0.5) : -Math.floor(-value + 0.5);
}

/**
 * Provisional K until a player has `provisionalMatches` rated games behind
 * them. Every game of a bo3 is one rated game, as in chess rating lists.
 */
export function kFactorFor(gamesPlayed: number, settings: EloSettings): number {
  return gamesPlayed < settings.provisionalMatches
    ? settings.kFactorProvisional
    : settings.kFactor;
}

export interface MatchRatingInput {
  teamA: string[];
  teamB: string[];
  scoreA: number;
  scoreB: number;
  ratings: Readonly<Record<string, number>>;
  gamesPlayed: Readonly<Record<string, number>>;
  settings: EloSettings;
}

/** Rating change per player for a single rated game: a bo1, or one game of a bo3. */
export function computeMatchDeltas(input: MatchRatingInput): Record<string, number> {
  const { teamA, teamB, scoreA, scoreB, ratings, gamesPlayed, settings } = input;
  const deltas: Record<string, number> = {};
  if (teamA.length === 0 || teamB.length === 0) return deltas;

  const ratingA = teamRating(teamA.map((id) => ratings[id] ?? settings.baseElo));
  const ratingB = teamRating(teamB.map((id) => ratings[id] ?? settings.baseElo));
  const expectedA = expectedScore(ratingA, ratingB);

  const actualA = scoreA > scoreB ? 1 : scoreA < scoreB ? 0 : 0.5;

  let multiplier = 1;
  if (settings.useMarginOfVictory && actualA !== 0.5) {
    const winnerEdge = actualA === 1 ? ratingA - ratingB : ratingB - ratingA;
    multiplier = marginMultiplier(scoreA - scoreB, winnerEdge);
  }

  for (const id of teamA) {
    const k = kFactorFor(gamesPlayed[id] ?? 0, settings);
    deltas[id] = roundDelta(k * multiplier * (actualA - expectedA));
  }
  for (const id of teamB) {
    const k = kFactorFor(gamesPlayed[id] ?? 0, settings);
    deltas[id] = roundDelta(k * multiplier * (expectedA - actualA));
  }
  return deltas;
}

export interface EloHistoryPoint {
  playerId: string;
  matchId: string | null;
  sequence: number;
  before: number;
  after: number;
  delta: number;
}

export interface EloReplay {
  /** Final rating per player id. */
  ratings: Record<string, number>;
  /**
   * Rated games per player id (byes excluded); drives the provisional
   * K-factor. A bo3 counts each of its games, so this is not the number of
   * matches played - the standings hold that.
   */
  gamesPlayed: Record<string, number>;
  /** Chronological rating points, base rating first. */
  history: EloHistoryPoint[];
  /** Per-match audit of the ratings before the match and the applied delta. */
  perMatch: Record<string, { before: Record<string, number>; delta: Record<string, number> }>;
}

/**
 * Decided matches: finished, not a bye, both teams present. This is the unit
 * standings, head-to-head and pairing history count. Ratings move earlier -
 * see `hasRatableGames` - so a bo3 in progress already changes a rating but
 * is not a played match yet.
 */
export function isRatedMatch(match: Match): boolean {
  return (
    match.status === 'done' &&
    !match.bye &&
    match.scoreA !== null &&
    match.scoreB !== null &&
    match.teamA.length > 0 &&
    match.teamB.length > 0
  );
}

/**
 * Matches with at least one recorded game, whether or not the series (bo3)
 * is decided yet - each game is its own Elo event the moment it is entered.
 */
export function hasRatableGames(match: Match): boolean {
  return !match.bye && match.teamA.length > 0 && match.teamB.length > 0 && match.games.length > 0;
}

export function compareMatchOrder(a: Match, b: Match): number {
  return a.sequence - b.sequence || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

interface RatedGameUnit {
  matchId: string;
  teamA: string[];
  teamB: string[];
  scoreA: number;
  scoreB: number;
}

/** Flattens every match's games into individually-rated units, in play order. */
function flattenRatedGames(matches: Match[]): RatedGameUnit[] {
  const units: RatedGameUnit[] = [];
  for (const match of matches.filter(hasRatableGames).sort(compareMatchOrder)) {
    for (const game of match.games) {
      units.push({
        matchId: match.id,
        teamA: match.teamA,
        teamB: match.teamB,
        scoreA: game.scoreA,
        scoreB: game.scoreB,
      });
    }
  }
  return units;
}

/**
 * Recomputes every rating from the players' base ratings by replaying every
 * recorded game, in match order.
 *
 * The app never mutates a rating in place: entering, editing or deleting a
 * result triggers a full replay. That keeps ratings consistent no matter how
 * results are corrected, and makes the whole rating state a pure function of
 * (base ratings, settings, match log).
 */
export function replayElo(
  players: Player[],
  matches: Match[],
  settings: EloSettings,
): EloReplay {
  const ratings: Record<string, number> = {};
  const gamesPlayed: Record<string, number> = {};
  const history: EloHistoryPoint[] = [];
  const perMatch: EloReplay['perMatch'] = {};

  for (const player of players) {
    ratings[player.id] = player.baseElo;
    gamesPlayed[player.id] = 0;
    history.push({
      playerId: player.id,
      matchId: null,
      sequence: -1,
      before: player.baseElo,
      after: player.baseElo,
      delta: 0,
    });
  }

  const rated = flattenRatedGames(matches);
  const matchById = new Map(matches.map((match) => [match.id, match]));

  for (const unit of rated) {
    const participants = [...unit.teamA, ...unit.teamB];
    // A result referencing a deleted player is skipped rather than crashing.
    if (participants.some((id) => ratings[id] === undefined)) continue;

    const before: Record<string, number> = {};
    for (const id of participants) before[id] = ratings[id]!;

    const deltas = computeMatchDeltas({
      teamA: unit.teamA,
      teamB: unit.teamB,
      scoreA: unit.scoreA,
      scoreB: unit.scoreB,
      ratings,
      gamesPlayed,
      settings,
    });

    const sequence = matchById.get(unit.matchId)?.sequence ?? 0;
    const existing = perMatch[unit.matchId];
    const matchBefore = existing?.before ?? before;
    const matchDelta = existing?.delta ?? {};

    for (const id of participants) {
      const delta = deltas[id] ?? 0;
      const after = before[id]! + delta;
      ratings[id] = after;
      gamesPlayed[id] = (gamesPlayed[id] ?? 0) + 1;
      history.push({
        playerId: id,
        matchId: unit.matchId,
        sequence,
        before: before[id]!,
        after,
        delta,
      });
      matchDelta[id] = (matchDelta[id] ?? 0) + delta;
    }

    perMatch[unit.matchId] = { before: matchBefore, delta: matchDelta };
  }

  return { ratings, gamesPlayed, history, perMatch };
}

/** Rating curve per player: base rating followed by the rating after each rated game. */
export function eloSeries(replay: EloReplay, playerIds: string[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const id of playerIds) out[id] = [];
  for (const point of replay.history) {
    const series = out[point.playerId];
    if (!series) continue;
    if (point.matchId === null) series.push(point.before);
    else series.push(point.after);
  }
  return out;
}

/**
 * Win probability for the A side of a prospective match - used to show how
 * even a suggested pairing is before it is played.
 */
export function matchWinProbability(
  teamA: string[],
  teamB: string[],
  ratings: Readonly<Record<string, number>>,
  fallback: number,
): number {
  const a = teamRating(teamA.map((id) => ratings[id] ?? fallback));
  const b = teamRating(teamB.map((id) => ratings[id] ?? fallback));
  return expectedScore(a, b);
}
