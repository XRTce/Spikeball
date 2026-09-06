import { teamRating } from '../elo';
import { partneredCount, facedCount, type PlayHistory } from './utils';

export interface SplitOptions {
  ratings: Readonly<Record<string, number>>;
  fallbackRating: number;
  history?: PlayHistory;
  /** Penalty, in rating points, for each time two players already partnered. */
  partnerRepeatPenalty?: number;
  /** Penalty for each time two players already faced each other. */
  opponentRepeatPenalty?: number;
}

export interface Split {
  teamA: string[];
  teamB: string[];
  /** Absolute rating gap between the two teams. */
  gap: number;
}

const THREE_WAY_SPLITS: [number, number, number, number][] = [
  [0, 1, 2, 3],
  [0, 2, 1, 3],
  [0, 3, 1, 2],
];

/**
 * Splits four players into the fairest 2v2. All three possible partitions are
 * evaluated, so the result is optimal for the given cost - there is no search
 * heuristic to get wrong. Two players are returned unchanged as a 1v1.
 */
export function balancedSplit(players: string[], options: SplitOptions): Split {
  const rating = (id: string) => options.ratings[id] ?? options.fallbackRating;

  if (players.length === 2) {
    const [a, b] = players as [string, string];
    return { teamA: [a], teamB: [b], gap: Math.abs(rating(a) - rating(b)) };
  }

  if (players.length !== 4) {
    throw new Error(`balancedSplit expects 2 or 4 players, received ${players.length}`);
  }

  const partnerPenalty = options.partnerRepeatPenalty ?? 45;
  const opponentPenalty = options.opponentRepeatPenalty ?? 12;
  const history = options.history;

  let best: Split | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  for (const [a1, a2, b1, b2] of THREE_WAY_SPLITS) {
    const teamA = [players[a1]!, players[a2]!];
    const teamB = [players[b1]!, players[b2]!];
    const gap = Math.abs(
      teamRating(teamA.map(rating)) - teamRating(teamB.map(rating)),
    );

    let cost = gap;
    if (history) {
      cost += partneredCount(history, teamA[0]!, teamA[1]!) * partnerPenalty;
      cost += partneredCount(history, teamB[0]!, teamB[1]!) * partnerPenalty;
      for (const x of teamA) {
        for (const y of teamB) cost += facedCount(history, x, y) * opponentPenalty;
      }
    }

    if (cost < bestCost) {
      bestCost = cost;
      best = { teamA, teamB, gap };
    }
  }

  return best!;
}
