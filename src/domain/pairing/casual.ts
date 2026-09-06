import { balancedSplit } from './balance';
import { createRng, type PlannedMatch, type PlayHistory } from './utils';

export interface CasualInput {
  /** Active player ids available right now. */
  candidates: string[];
  ratings: Readonly<Record<string, number>>;
  fallbackRating: number;
  history: PlayHistory;
  /** 2 for doubles, 1 for singles. */
  teamSize: number;
  /** Seed for tie-breaking, so "shuffle" produces a different-but-fair match. */
  seed?: number;
}

/**
 * Picks the next ad-hoc match.
 *
 * Selection is a rest-fairness queue: whoever has played fewest matches goes
 * on first, ties broken by who has been waiting longest, then randomly. Once
 * the four players are chosen, the teams themselves are formed by
 * {@link balancedSplit}, which keeps the match close and avoids repeating the
 * same partnerships - the heuristic Americano-style social formats use.
 */
export function suggestCasualMatch(input: CasualInput): PlannedMatch | null {
  const needed = input.teamSize * 2;
  if (input.candidates.length < needed) return null;

  const rng = createRng(input.seed ?? 1);
  const jitter = new Map(input.candidates.map((id) => [id, rng()]));

  const queue = [...input.candidates].sort((a, b) => {
    const playedA = input.history.played[a] ?? 0;
    const playedB = input.history.played[b] ?? 0;
    if (playedA !== playedB) return playedA - playedB;
    const seenA = input.history.lastSeen[a] ?? -1;
    const seenB = input.history.lastSeen[b] ?? -1;
    if (seenA !== seenB) return seenA - seenB;
    return (jitter.get(a) ?? 0) - (jitter.get(b) ?? 0);
  });

  const selected = queue.slice(0, needed);
  const split = balancedSplit(selected, {
    ratings: input.ratings,
    fallbackRating: input.fallbackRating,
    history: input.history,
  });

  return { round: 1, order: 0, teamA: split.teamA, teamB: split.teamB, bye: false };
}

/** Forms the fairest teams from an explicitly chosen set of players. */
export function splitChosenPlayers(
  players: string[],
  input: Omit<CasualInput, 'candidates' | 'seed'>,
): PlannedMatch | null {
  const needed = input.teamSize * 2;
  if (players.length !== needed) return null;
  const split = balancedSplit(players, {
    ratings: input.ratings,
    fallbackRating: input.fallbackRating,
    history: input.history,
  });
  return { round: 1, order: 0, teamA: split.teamA, teamB: split.teamB, bye: false };
}
