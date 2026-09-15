import { isRatedMatch, compareMatchOrder, type EloReplay } from './elo';
import type { Match, Player, StandingRow } from './types';

export interface StandingsOptions {
  /** Restrict the table to these player ids (e.g. tournament participants). */
  playerIds?: string[];
  /** Only count matches from these stages. */
  stages?: Match['stage'][];
}

/**
 * Aggregates a match log into a standings table.
 *
 * Ranking follows the usual roundnet club order: wins first, then point
 * difference, then points scored, then rating, then name for a stable result.
 */
export function buildStandings(
  players: Player[],
  matches: Match[],
  replay: EloReplay,
  options: StandingsOptions = {},
): StandingRow[] {
  const allowed = options.playerIds ? new Set(options.playerIds) : null;
  const stages = options.stages ? new Set(options.stages) : null;

  const rows = new Map<string, StandingRow>();
  for (const player of players) {
    if (allowed && !allowed.has(player.id)) continue;
    const elo = replay.ratings[player.id] ?? player.baseElo;
    rows.set(player.id, {
      playerId: player.id,
      name: player.name,
      played: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
      winRate: 0,
      elo,
      baseElo: player.baseElo,
      eloChange: elo - player.baseElo,
      form: [],
    });
  }

  const relevant = matches
    .filter(isRatedMatch)
    .filter((m) => !stages || stages.has(m.stage))
    .sort(compareMatchOrder);

  for (const match of relevant) {
    const scoreA = match.scoreA!;
    const scoreB = match.scoreB!;
    const aWon = scoreA > scoreB;

    for (const [team, own, other, won] of [
      [match.teamA, scoreA, scoreB, aWon] as const,
      [match.teamB, scoreB, scoreA, !aWon] as const,
    ]) {
      for (const id of team) {
        const row = rows.get(id);
        if (!row) continue;
        row.played += 1;
        row.pointsFor += own;
        row.pointsAgainst += other;
        if (won) row.wins += 1;
        else row.losses += 1;
        row.form.unshift(won);
        if (row.form.length > 5) row.form.pop();
      }
    }
  }

  for (const row of rows.values()) {
    row.pointDiff = row.pointsFor - row.pointsAgainst;
    row.winRate = row.played === 0 ? 0 : row.wins / row.played;
  }

  return [...rows.values()].sort(compareStandings);
}

export function compareStandings(a: StandingRow, b: StandingRow): number {
  return (
    b.wins - a.wins ||
    b.pointDiff - a.pointDiff ||
    b.pointsFor - a.pointsFor ||
    b.elo - a.elo ||
    a.name.localeCompare(b.name, 'de')
  );
}

/** Head-to-head record between two players across the given matches. */
export function headToHead(
  matches: Match[],
  playerA: string,
  playerB: string,
): { asOpponents: [number, number]; asPartners: { played: number; wins: number } } {
  let winsA = 0;
  let winsB = 0;
  let partnerPlayed = 0;
  let partnerWins = 0;

  for (const match of matches) {
    if (!isRatedMatch(match)) continue;
    const aInA = match.teamA.includes(playerA);
    const bInA = match.teamA.includes(playerB);
    const aInB = match.teamB.includes(playerA);
    const bInB = match.teamB.includes(playerB);
    const aWon = match.scoreA! > match.scoreB!;

    if ((aInA && bInB) || (aInB && bInA)) {
      const aSideWon = aInA ? aWon : !aWon;
      if (aSideWon) winsA += 1;
      else winsB += 1;
    } else if ((aInA && bInA) || (aInB && bInB)) {
      partnerPlayed += 1;
      const teamWon = aInA ? aWon : !aWon;
      if (teamWon) partnerWins += 1;
    }
  }

  return { asOpponents: [winsA, winsB], asPartners: { played: partnerPlayed, wins: partnerWins } };
}

export interface Podium {
  first: StandingRow | null;
  second: StandingRow | null;
  third: StandingRow | null;
}

/**
 * Final ranking. Elimination formats are decided on the pitch, so the podium
 * is read out of the bracket; the group formats fall back to the table.
 */
export function podiumFromStandings(standings: StandingRow[]): Podium {
  return {
    first: standings[0] ?? null,
    second: standings[1] ?? null,
    third: standings[2] ?? null,
  };
}
