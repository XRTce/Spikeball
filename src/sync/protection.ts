/**
 * Which changes to a public tournament need its admin password.
 *
 * The rule is a diff between two snapshots, not a list of allowed commands, so
 * the server can enforce it without trusting what a client says it did, and
 * the client can check a command before it ever leaves the device. Both sides
 * run this same function.
 *
 * Always allowed: recording and correcting scores, adding players and matches,
 * renaming, toggling a player's availability, deleting a match that has not
 * been played yet. Everything derived (ratings, bracket progression, the
 * automatic "finished" once the last bracket match is in) is allowed too, as
 * long as it follows from allowed input.
 *
 * Must stay free of browser and Node APIs; the server bundles it.
 */
import type { Match, Tournament } from '../domain/types';
import { bracketResult } from '../domain/pairing/elimination';

export type ProtectedReason =
  /** A player was removed (their matches go with them). */
  | 'delete_player'
  /** A played match was deleted, or its result was cleared. */
  | 'delete_result'
  /** Elo rules, points to win, Turniermodus config, or a player's start Elo. */
  | 'settings'
  /** The bracket was thrown away, or the tournament finished/reopened by hand. */
  | 'bracket'
  /** The Turniermodus countdown was started, or drafted teams became a bracket. */
  | 'start'
  /** Deleting the tournament for everyone. Checked by the server's DELETE. */
  | 'delete_tournament'
  /** Setting, changing or removing the password. Checked by the password endpoint. */
  | 'password';

const ORDER: ProtectedReason[] = [
  'delete_player',
  'delete_result',
  'settings',
  'bracket',
  'start',
  'delete_tournament',
  'password',
];

/** The subset of a snapshot the rule looks at. */
export interface ProtectionInput {
  tournament: Tournament;
  players: { id: string; baseElo: number }[];
  matches: Match[];
}

/** Every reason the change from `before` to `after` needs the password; empty = free. */
export function protectedChanges(before: ProtectionInput, after: ProtectionInput): ProtectedReason[] {
  const reasons = new Set<ProtectedReason>();

  const afterPlayers = new Map(after.players.map((player) => [player.id, player]));
  for (const player of before.players) {
    const next = afterPlayers.get(player.id);
    if (!next) reasons.add('delete_player');
    else if (next.baseElo !== player.baseElo) reasons.add('settings');
  }

  const afterMatches = new Map(after.matches.map((match) => [match.id, match]));
  for (const match of before.matches) {
    if (match.status !== 'done' || match.bye) continue;
    const next = afterMatches.get(match.id);
    // A played match whose teams changed was re-routed by the bracket after an
    // earlier result was corrected; that is a consequence, not a deletion.
    if (!next || (next.status !== 'done' && sameTeams(match, next))) {
      reasons.add('delete_result');
    }
  }

  const a = before.tournament;
  const b = after.tournament;

  if (!sameElo(a, b) || a.play.pointsToWin !== b.play.pointsToWin || !sameTimedConfig(a, b)) {
    reasons.add('settings');
  }

  if ((a.timedMode?.timerStartedAt ?? null) !== (b.timedMode?.timerStartedAt ?? null)) {
    reasons.add('start');
  }
  if (a.phase === 'casual' && b.phase === 'tournament') reasons.add('start');
  if (a.phase === 'tournament' && b.phase === 'tournament') {
    if ((a.bracket?.createdAt ?? null) !== (b.bracket?.createdAt ?? null)) reasons.add('start');
  }

  if (a.phase === 'tournament' && b.phase === 'casual') reasons.add('bracket');
  if (a.status !== b.status && a.phase === b.phase && !statusIsDerived(b, after.matches)) {
    reasons.add('bracket');
  }

  return ORDER.filter((reason) => reasons.has(reason));
}

/**
 * Inside a running bracket the status follows the results: recalculate()
 * marks the tournament finished when the last match is in and running again
 * when a result is corrected. Only a status that disagrees with that was set
 * by hand.
 */
function statusIsDerived(tournament: Tournament, matches: Match[]): boolean {
  if (tournament.phase !== 'tournament') return false;
  const complete = bracketResult(matches).complete;
  return tournament.status === (complete ? 'finished' : 'running');
}

function sameTeams(a: Match, b: Match): boolean {
  return a.teamA.join(',') === b.teamA.join(',') && a.teamB.join(',') === b.teamB.join(',');
}

function sameElo(a: Tournament, b: Tournament): boolean {
  return (
    a.elo.baseElo === b.elo.baseElo &&
    a.elo.kFactor === b.elo.kFactor &&
    a.elo.kFactorProvisional === b.elo.kFactorProvisional &&
    a.elo.provisionalMatches === b.elo.provisionalMatches &&
    a.elo.useMarginOfVictory === b.elo.useMarginOfVictory
  );
}

function sameTimedConfig(a: Tournament, b: Tournament): boolean {
  if (!a.timedMode || !b.timedMode) return a.timedMode === b.timedMode;
  return (
    a.timedMode.freePlayMinutes === b.timedMode.freePlayMinutes &&
    a.timedMode.draftSize === b.timedMode.draftSize &&
    a.timedMode.maxPartnerRepeats === b.timedMode.maxPartnerRepeats
  );
}
