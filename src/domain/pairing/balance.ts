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
  /**
   * Hard cap on how often two players may share a team. A split that would
   * exceed it for either team is excluded, unless every split would - a match
   * still has to be produced, so the cap is dropped for that one case.
   */
  maxPartnerRepeats?: number | null;
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
 * heuristic to get wrong.
 */
export function balancedSplit(players: string[], options: SplitOptions): Split {
  const rating = (id: string) => options.ratings[id] ?? options.fallbackRating;

  if (players.length !== 4) {
    throw new Error(`balancedSplit expects 4 players, received ${players.length}`);
  }

  const partnerPenalty = options.partnerRepeatPenalty ?? 45;
  const opponentPenalty = options.opponentRepeatPenalty ?? 12;
  const history = options.history;
  const maxPartnerRepeats = options.maxPartnerRepeats;

  const candidates = THREE_WAY_SPLITS.map(([a1, a2, b1, b2]) => {
    const teamA = [players[a1]!, players[a2]!];
    const teamB = [players[b1]!, players[b2]!];
    const gap = Math.abs(
      teamRating(teamA.map(rating)) - teamRating(teamB.map(rating)),
    );

    let cost = gap;
    let overCap = false;
    if (history) {
      const partnersA = partneredCount(history, teamA[0]!, teamA[1]!);
      const partnersB = partneredCount(history, teamB[0]!, teamB[1]!);
      cost += partnersA * partnerPenalty;
      cost += partnersB * partnerPenalty;
      if (maxPartnerRepeats != null && (partnersA >= maxPartnerRepeats || partnersB >= maxPartnerRepeats)) {
        overCap = true;
      }
      for (const x of teamA) {
        for (const y of teamB) cost += facedCount(history, x, y) * opponentPenalty;
      }
    }

    return { split: { teamA, teamB, gap }, cost, overCap };
  });

  // Splits within the cap win outright; only if every split is over it does
  // the cap get dropped, so a match can still be produced.
  const withinCap = candidates.filter((entry) => !entry.overCap);
  const pool = withinCap.length > 0 ? withinCap : candidates;

  return pool.reduce((best, entry) => (entry.cost < best.cost ? entry : best)).split;
}
