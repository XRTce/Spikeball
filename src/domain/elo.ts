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

export function kFactorFor(matchesPlayed: number, settings: EloSettings): number {
  return matchesPlayed < settings.provisionalMatches
    ? settings.kFactorProvisional
    : settings.kFactor;
}

export interface MatchRatingInput {
  teamA: string[];
  teamB: string[];
  scoreA: number;
  scoreB: number;
  ratings: Readonly<Record<string, number>>;
  matchesPlayed: Readonly<Record<string, number>>;
  settings: EloSettings;
}

/** Rating change per player for a single completed match. */
export function computeMatchDeltas(input: MatchRatingInput): Record<string, number> {
  const { teamA, teamB, scoreA, scoreB, ratings, matchesPlayed, settings } = input;
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
    const k = kFactorFor(matchesPlayed[id] ?? 0, settings);
    deltas[id] = roundDelta(k * multiplier * (actualA - expectedA));
  }
  for (const id of teamB) {
    const k = kFactorFor(matchesPlayed[id] ?? 0, settings);
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
  /** Rated matches per player id (byes excluded). */
  matchesPlayed: Record<string, number>;
  /** Chronological rating points, base rating first. */
  history: EloHistoryPoint[];
  /** Per-match audit of the ratings before the match and the applied delta. */
  perMatch: Record<string, { before: Record<string, number>; delta: Record<string, number> }>;
}

/** Matches that actually move ratings: finished, not a bye, both teams present. */
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

export function compareMatchOrder(a: Match, b: Match): number {
  return a.sequence - b.sequence || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/**
 * Recomputes every rating from the players' base ratings by replaying all
 * finished matches in order.
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
  const matchesPlayed: Record<string, number> = {};
  const history: EloHistoryPoint[] = [];
  const perMatch: EloReplay['perMatch'] = {};

  for (const player of players) {
    ratings[player.id] = player.baseElo;
    matchesPlayed[player.id] = 0;
    history.push({
      playerId: player.id,
      matchId: null,
      sequence: -1,
      before: player.baseElo,
      after: player.baseElo,
      delta: 0,
    });
  }

  const rated = matches.filter(isRatedMatch).sort(compareMatchOrder);

  for (const match of rated) {
    const participants = [...match.teamA, ...match.teamB];
    // A result referencing a deleted player is skipped rather than crashing.
    if (participants.some((id) => ratings[id] === undefined)) continue;

    const before: Record<string, number> = {};
    for (const id of participants) before[id] = ratings[id]!;

    const deltas = computeMatchDeltas({
      teamA: match.teamA,
      teamB: match.teamB,
      scoreA: match.scoreA!,
      scoreB: match.scoreB!,
      ratings,
      matchesPlayed,
      settings,
    });

    for (const id of participants) {
      const delta = deltas[id] ?? 0;
      const after = before[id]! + delta;
      ratings[id] = after;
      matchesPlayed[id] = (matchesPlayed[id] ?? 0) + 1;
      history.push({
        playerId: id,
        matchId: match.id,
        sequence: match.sequence,
        before: before[id]!,
        after,
        delta,
      });
    }

    perMatch[match.id] = { before, delta: deltas };
  }

  return { ratings, matchesPlayed, history, perMatch };
}

/** Rating curve per player: base rating followed by the rating after each match. */
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
