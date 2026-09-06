import { teamRating } from '../elo';
import {
  GHOST,
  circleMethodRounds,
  createRng,
  emptyHistory,
  facedCount,
  minCostPairing,
  pairKey,
  shuffle,
  type PlannedMatch,
} from './utils';

export interface RoundRobinInput {
  playerIds: string[];
  ratings: Readonly<Record<string, number>>;
  fallbackRating: number;
  /** 2 for doubles (whist schedule), 1 for singles (plain circle method). */
  teamSize: number;
  seed?: number;
}

/**
 * Round robin for rotating partners - a whist tournament schedule.
 *
 * The circle method first produces every possible partnership exactly once
 * across n-1 rounds. Within each round those partnerships are then matched
 * against each other by minimum-cost pairing, weighting rating balance against
 * how often the two sides have already met. The result: everybody partners
 * everybody once, and opponents repeat as late as possible.
 *
 * Singles collapses to the plain circle method, where the same construction
 * already yields the classic everyone-plays-everyone schedule.
 */
export function roundRobinSchedule(input: RoundRobinInput): PlannedMatch[] {
  const rng = createRng(input.seed ?? 7);
  const players = shuffle(input.playerIds, rng);
  const rating = (id: string) => input.ratings[id] ?? input.fallbackRating;

  if (players.length < (input.teamSize === 2 ? 4 : 2)) return [];

  if (input.teamSize === 1) {
    return singlesRoundRobin(players);
  }

  const history = emptyHistory(players);
  const matches: PlannedMatch[] = [];
  const rounds = circleMethodRounds(players);
  let roundNumber = 0;

  for (const pairs of rounds) {
    const realPairs: [string, string][] = [];
    const byePlayers: string[] = [];

    for (const [a, b] of pairs) {
      if (a === GHOST) byePlayers.push(b!);
      else if (b === GHOST) byePlayers.push(a!);
      else realPairs.push([a!, b!]);
    }

    // An odd number of partnerships cannot all play; the pair that has sat out
    // least so far takes the bye, which spreads rest time evenly.
    if (realPairs.length % 2 === 1) {
      let restIndex = 0;
      let fewestByes = Number.POSITIVE_INFINITY;
      realPairs.forEach(([a, b], index) => {
        const byes = (history.byes[a] ?? 0) + (history.byes[b] ?? 0);
        if (byes < fewestByes) {
          fewestByes = byes;
          restIndex = index;
        }
      });
      const [resting] = realPairs.splice(restIndex, 1);
      byePlayers.push(...resting!);
    }

    if (realPairs.length === 0 && byePlayers.length === 0) continue;

    roundNumber += 1;
    let order = 0;

    if (realPairs.length > 0) {
      const games = minCostPairing(realPairs, (x, y) => {
        const gap = Math.abs(
          teamRating(x.map(rating)) - teamRating(y.map(rating)),
        );
        let repeats = 0;
        for (const p of x) for (const q of y) repeats += facedCount(history, p, q);
        return gap + repeats * 250;
      });

      for (const [teamA, teamB] of games) {
        matches.push({ round: roundNumber, order, teamA: [...teamA], teamB: [...teamB], bye: false });
        order += 1;
        for (const p of teamA) {
          for (const q of teamB) {
            const key = pairKey(p, q);
            history.faced[key] = (history.faced[key] ?? 0) + 1;
          }
        }
      }
    }

    for (const player of byePlayers) {
      history.byes[player] = (history.byes[player] ?? 0) + 1;
      matches.push({ round: roundNumber, order, teamA: [player], teamB: [], bye: true });
      order += 1;
    }
  }

  return matches;
}

function singlesRoundRobin(players: string[]): PlannedMatch[] {
  const matches: PlannedMatch[] = [];
  const rounds = circleMethodRounds(players);
  let roundNumber = 0;

  for (const pairs of rounds) {
    roundNumber += 1;
    let order = 0;
    for (const [a, b] of pairs) {
      if (a === GHOST || b === GHOST) {
        const real = a === GHOST ? b! : a!;
        matches.push({ round: roundNumber, order, teamA: [real], teamB: [], bye: true });
      } else {
        matches.push({ round: roundNumber, order, teamA: [a!], teamB: [b!], bye: false });
      }
      order += 1;
    }
  }

  return matches;
}

/** Rounds and matches a round robin will produce, for the setup preview. */
export function roundRobinSize(
  playerCount: number,
  teamSize: number,
): { rounds: number; matches: number } {
  if (teamSize === 1) {
    if (playerCount < 2) return { rounds: 0, matches: 0 };
    const rounds = playerCount % 2 === 0 ? playerCount - 1 : playerCount;
    return { rounds, matches: (playerCount * (playerCount - 1)) / 2 };
  }
  if (playerCount < 4) return { rounds: 0, matches: 0 };
  const rounds = playerCount % 2 === 0 ? playerCount - 1 : playerCount;
  const pairsPerRound = Math.floor(playerCount / 2);
  const gamesPerRound = Math.floor(pairsPerRound / 2);
  return { rounds, matches: rounds * gamesPerRound };
}
