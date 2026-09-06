import { isRatedMatch } from '../elo';
import type { Match } from '../types';

/** Deterministic PRNG (mulberry32) so schedules can be reproduced and tested. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Stable key for an unordered pair of player ids. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface PlayHistory {
  /** How many rated matches each player has played. */
  played: Record<string, number>;
  /** Sequence number of each player's last match; -1 when they never played. */
  lastSeen: Record<string, number>;
  /** How often two players were partners. */
  partnered: Record<string, number>;
  /** How often two players faced each other. */
  faced: Record<string, number>;
  /** How many scheduled rounds each player sat out. */
  byes: Record<string, number>;
}

export function emptyHistory(playerIds: string[]): PlayHistory {
  const played: Record<string, number> = {};
  const lastSeen: Record<string, number> = {};
  const byes: Record<string, number> = {};
  for (const id of playerIds) {
    played[id] = 0;
    lastSeen[id] = -1;
    byes[id] = 0;
  }
  return { played, lastSeen, partnered: {}, faced: {}, byes };
}

/**
 * Summarises who has played with and against whom. Scheduled-but-unplayed
 * matches count too, otherwise the planner would happily repeat a pairing that
 * is already on the pitch.
 */
export function buildHistory(playerIds: string[], matches: Match[]): PlayHistory {
  const history = emptyHistory(playerIds);
  const known = new Set(playerIds);

  for (const match of matches) {
    const counts = isRatedMatch(match);
    if (match.bye) continue;

    for (const team of [match.teamA, match.teamB]) {
      for (let i = 0; i < team.length; i += 1) {
        const a = team[i]!;
        if (!known.has(a)) continue;
        if (counts) {
          history.played[a] = (history.played[a] ?? 0) + 1;
          history.lastSeen[a] = Math.max(history.lastSeen[a] ?? -1, match.sequence);
        }
        for (let j = i + 1; j < team.length; j += 1) {
          const b = team[j]!;
          if (!known.has(b)) continue;
          const key = pairKey(a, b);
          history.partnered[key] = (history.partnered[key] ?? 0) + 1;
        }
      }
    }

    for (const a of match.teamA) {
      if (!known.has(a)) continue;
      for (const b of match.teamB) {
        if (!known.has(b)) continue;
        const key = pairKey(a, b);
        history.faced[key] = (history.faced[key] ?? 0) + 1;
      }
    }
  }

  return history;
}

export function partneredCount(history: PlayHistory, a: string, b: string): number {
  return history.partnered[pairKey(a, b)] ?? 0;
}

export function facedCount(history: PlayHistory, a: string, b: string): number {
  return history.faced[pairKey(a, b)] ?? 0;
}

/** A planned but not yet persisted match. */
export interface PlannedMatch {
  round: number;
  order: number;
  teamA: string[];
  teamB: string[];
  bye: boolean;
}

/**
 * Minimum-cost perfect matching over an even number of items.
 *
 * Exhaustive for up to 12 items (10 395 matchings, microseconds) which covers
 * every realistic round size; above that it falls back to a greedy pass with a
 * 2-opt improvement sweep, which is within a few percent of optimal here.
 */
export function minCostPairing<T>(
  items: readonly T[],
  cost: (a: T, b: T) => number,
): [T, T][] {
  if (items.length % 2 !== 0) throw new Error('minCostPairing needs an even number of items');
  if (items.length === 0) return [];
  if (items.length <= 12) return exhaustivePairing(items, cost);
  return improvePairing(greedyPairing(items, cost), cost);
}

function exhaustivePairing<T>(items: readonly T[], cost: (a: T, b: T) => number): [T, T][] {
  let best: [T, T][] = [];
  let bestCost = Number.POSITIVE_INFINITY;

  const search = (remaining: readonly T[], acc: [T, T][], accCost: number) => {
    if (accCost >= bestCost) return;
    if (remaining.length === 0) {
      bestCost = accCost;
      best = [...acc];
      return;
    }
    const [first, ...rest] = remaining;
    for (let i = 0; i < rest.length; i += 1) {
      const partner = rest[i]!;
      const next = rest.filter((_, index) => index !== i);
      acc.push([first!, partner]);
      search(next, acc, accCost + cost(first!, partner));
      acc.pop();
    }
  };

  search(items, [], 0);
  return best;
}

function greedyPairing<T>(items: readonly T[], cost: (a: T, b: T) => number): [T, T][] {
  const pool = [...items];
  const out: [T, T][] = [];
  while (pool.length > 1) {
    const first = pool.shift()!;
    let bestIndex = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pool.length; i += 1) {
      const c = cost(first, pool[i]!);
      if (c < bestCost) {
        bestCost = c;
        bestIndex = i;
      }
    }
    out.push([first, pool.splice(bestIndex, 1)[0]!]);
  }
  return out;
}

function improvePairing<T>(pairs: [T, T][], cost: (a: T, b: T) => number): [T, T][] {
  const result = [...pairs];
  let improved = true;
  let guard = 0;
  while (improved && guard < 40) {
    improved = false;
    guard += 1;
    for (let i = 0; i < result.length; i += 1) {
      for (let j = i + 1; j < result.length; j += 1) {
        const [a1, a2] = result[i]!;
        const [b1, b2] = result[j]!;
        const current = cost(a1, a2) + cost(b1, b2);
        const swap1 = cost(a1, b1) + cost(a2, b2);
        const swap2 = cost(a1, b2) + cost(a2, b1);
        if (swap1 < current && swap1 <= swap2) {
          result[i] = [a1, b1];
          result[j] = [a2, b2];
          improved = true;
        } else if (swap2 < current) {
          result[i] = [a1, b2];
          result[j] = [a2, b1];
          improved = true;
        }
      }
    }
  }
  return result;
}

/**
 * Circle method (Berger tables): every element meets every other exactly once
 * across n-1 rounds. An odd count gets a ghost entry whose opponent sits out.
 */
export function circleMethodRounds(entries: readonly string[]): string[][][] {
  const list = [...entries];
  const ghost = '__bye__';
  if (list.length % 2 === 1) list.push(ghost);

  const n = list.length;
  const rounds: string[][][] = [];
  const order = [...list];

  for (let r = 0; r < n - 1; r += 1) {
    const pairs: string[][] = [];
    for (let i = 0; i < n / 2; i += 1) {
      const a = order[i]!;
      const b = order[n - 1 - i]!;
      pairs.push([a, b]);
    }
    rounds.push(pairs);
    // Rotate everything except the first slot.
    const rotating = order.slice(1);
    rotating.unshift(rotating.pop()!);
    order.splice(1, rotating.length, ...rotating);
  }

  return rounds;
}

export const GHOST = '__bye__';
