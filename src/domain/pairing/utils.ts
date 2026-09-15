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

