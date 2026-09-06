import type { StandingRow } from '../types';
import { teamRating } from '../elo';
import {
  facedCount,
  partneredCount,
  type PlannedMatch,
  type PlayHistory,
} from './utils';

export interface SwissInput {
  /** Participants of the tournament. */
  playerIds: string[];
  /** Current standings, best first. Empty for round 1. */
  standings: StandingRow[];
  ratings: Readonly<Record<string, number>>;
  fallbackRating: number;
  history: PlayHistory;
  teamSize: number;
  /** 1-based number of the round being generated. */
  round: number;
}

const QUAD_SPLITS: [number, number, number, number][] = [
  // Mexicano default: best plays with weakest against the middle pair.
  [0, 3, 1, 2],
  [0, 1, 2, 3],
  [0, 2, 1, 3],
];

/**
 * One Swiss round.
 *
 * Players are ranked (by rating in round 1, by standings afterwards) and cut
 * into consecutive groups of four. Each group is then split using the
 * Mexicano rule - rank 1 partners rank 4 against ranks 2 and 3 - which keeps
 * every match close while continuously rotating partners. A split that would
 * repeat an existing partnership is passed over in favour of one that does
 * not. Singles falls back to Monrad pairing: adjacent ranks meet, sliding down
 * the table to avoid a rematch.
 */
export function swissRound(input: SwissInput): PlannedMatch[] {
  const ranked = rankPlayers(input);
  const groupSize = input.teamSize * 2;
  if (ranked.length < groupSize) return [];

  const playableCount = Math.floor(ranked.length / groupSize) * groupSize;
  const sitOutCount = ranked.length - playableCount;

  // Byes go to whoever has sat out least, lowest ranked first on a tie.
  const sitters = new Set(
    [...ranked]
      .map((id, rank) => ({ id, rank }))
      .sort(
        (a, b) =>
          (input.history.byes[a.id] ?? 0) - (input.history.byes[b.id] ?? 0) ||
          b.rank - a.rank,
      )
      .slice(0, sitOutCount)
      .map((entry) => entry.id),
  );

  const playing = ranked.filter((id) => !sitters.has(id));
  const matches: PlannedMatch[] =
    input.teamSize === 1 ? monradPairing(playing, input) : quadPairing(playing, input);

  let order = matches.length;
  for (const id of ranked) {
    if (!sitters.has(id)) continue;
    matches.push({ round: input.round, order, teamA: [id], teamB: [], bye: true });
    order += 1;
  }

  return matches;
}

function rankPlayers(input: SwissInput): string[] {
  const participants = new Set(input.playerIds);
  if (input.round <= 1 || input.standings.length === 0) {
    return [...input.playerIds].sort(
      (a, b) =>
        (input.ratings[b] ?? input.fallbackRating) - (input.ratings[a] ?? input.fallbackRating) ||
        a.localeCompare(b),
    );
  }
  const ordered = input.standings.filter((row) => participants.has(row.playerId)).map((r) => r.playerId);
  const seen = new Set(ordered);
  const missing = input.playerIds.filter((id) => !seen.has(id));
  return [...ordered, ...missing];
}

function quadPairing(playing: string[], input: SwissInput): PlannedMatch[] {
  const rating = (id: string) => input.ratings[id] ?? input.fallbackRating;
  const matches: PlannedMatch[] = [];

  for (let start = 0; start + 3 < playing.length; start += 4) {
    const quad = playing.slice(start, start + 4) as [string, string, string, string];

    let best = QUAD_SPLITS[0]!;
    let bestCost = Number.POSITIVE_INFINITY;

    QUAD_SPLITS.forEach((split, index) => {
      const [a1, a2, b1, b2] = split;
      const teamA = [quad[a1]!, quad[a2]!];
      const teamB = [quad[b1]!, quad[b2]!];

      let cost = index; // keeps the Mexicano split as the tie-break winner
      cost += partneredCount(input.history, teamA[0]!, teamA[1]!) * 1000;
      cost += partneredCount(input.history, teamB[0]!, teamB[1]!) * 1000;
      for (const x of teamA) {
        for (const y of teamB) cost += facedCount(input.history, x, y) * 20;
      }
      cost += Math.abs(teamRating(teamA.map(rating)) - teamRating(teamB.map(rating))) * 0.1;

      if (cost < bestCost) {
        bestCost = cost;
        best = split;
      }
    });

    const [a1, a2, b1, b2] = best;
    matches.push({
      round: input.round,
      order: matches.length,
      teamA: [quad[a1]!, quad[a2]!],
      teamB: [quad[b1]!, quad[b2]!],
      bye: false,
    });
  }

  return matches;
}

function monradPairing(playing: string[], input: SwissInput): PlannedMatch[] {
  const remaining = [...playing];
  const matches: PlannedMatch[] = [];

  while (remaining.length >= 2) {
    const player = remaining.shift()!;
    let opponentIndex = remaining.findIndex((id) => facedCount(input.history, player, id) === 0);
    if (opponentIndex === -1) opponentIndex = 0;
    const opponent = remaining.splice(opponentIndex, 1)[0]!;
    matches.push({
      round: input.round,
      order: matches.length,
      teamA: [player],
      teamB: [opponent],
      bye: false,
    });
  }

  return matches;
}

/**
 * Rounds needed for a Swiss field to separate cleanly. Chess uses
 * ceil(log2(n)); with four players per match the effective field size is a
 * quarter of that, so the same rule is applied to the number of quads and
 * floored at three rounds to keep an evening worth playing.
 */
export function suggestedSwissRounds(playerCount: number, teamSize: number): number {
  const units = teamSize === 2 ? Math.max(2, Math.ceil(playerCount / 2)) : playerCount;
  return Math.max(3, Math.min(12, Math.ceil(Math.log2(Math.max(2, units))) + 1));
}
