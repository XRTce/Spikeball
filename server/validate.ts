/**
 * Hand-written snapshot validation. This is not a full schema: it exists to
 * keep garbage (wrong types, missing ids, cross-tournament data) out of the
 * database, not to re-implement every domain invariant. A player or match
 * referencing an id the server has never heard of is allowed through - that
 * is the client's business, not ours (see docs/SYNC.md).
 */
import { LIMITS, type TournamentSnapshot } from '../src/sync/protocol';

export type ValidationResult = { ok: true; snapshot: TournamentSnapshot } | { ok: false; message: string };

const MAX_ID_LENGTH = 64;
const MAX_STRING_LENGTH = 500;

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isId(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function isBoundedString(value: unknown, max = MAX_STRING_LENGTH): value is string {
  return isString(value) && value.length <= max;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullOr<T>(value: unknown, check: (v: unknown) => v is T): value is T | null {
  return value === null || check(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maxLength && value.every((item) => isId(item));
}

const TOURNAMENT_PHASES = new Set(['casual', 'tournament']);
const TOURNAMENT_STATUSES = new Set(['open', 'running', 'finished']);
const MATCH_STAGES = new Set(['casual', 'winners', 'third_place']);
const MATCH_STATUSES = new Set(['scheduled', 'done']);
const SLOTS = new Set(['A', 'B']);

function validateEloSettings(value: unknown): string | null {
  if (!isPlainObject(value)) return 'tournament.elo must be an object';
  const fields: [string, unknown][] = [
    ['baseElo', value.baseElo],
    ['kFactor', value.kFactor],
    ['kFactorProvisional', value.kFactorProvisional],
    ['provisionalMatches', value.provisionalMatches],
  ];
  for (const [name, field] of fields) {
    if (!isFiniteNumber(field)) return `tournament.elo.${name} must be a number`;
  }
  if (typeof value.useMarginOfVictory !== 'boolean') return 'tournament.elo.useMarginOfVictory must be a boolean';
  return null;
}

function validatePlaySettings(value: unknown): string | null {
  if (!isPlainObject(value)) return 'tournament.play must be an object';
  if (!isFiniteNumber(value.pointsToWin)) return 'tournament.play.pointsToWin must be a number';
  if (!isNullOr(value.participantLimit, isFiniteNumber)) {
    return 'tournament.play.participantLimit must be a number or null';
  }
  if (typeof value.thirdPlaceMatch !== 'boolean') return 'tournament.play.thirdPlaceMatch must be a boolean';
  return null;
}

function validateBracket(value: unknown): string | null {
  if (value === null) return null;
  if (!isPlainObject(value)) return 'tournament.bracket must be an object or null';
  if (value.format !== 'single_elim') return 'tournament.bracket.format must be single_elim';
  if (!isFiniteNumber(value.size)) return 'tournament.bracket.size must be a number';
  if (!isFiniteNumber(value.createdAt)) return 'tournament.bracket.createdAt must be a number';
  if (!Array.isArray(value.teams) || value.teams.length > LIMITS.players) {
    return 'tournament.bracket.teams must be an array';
  }
  for (const team of value.teams) {
    if (!isPlainObject(team)) return 'tournament.bracket.teams entries must be objects';
    if (!isId(team.id)) return 'tournament.bracket.teams[].id is invalid';
    if (!isFiniteNumber(team.seed)) return 'tournament.bracket.teams[].seed must be a number';
    if (!isBoundedString(team.name)) return 'tournament.bracket.teams[].name is invalid';
    if (!isStringArray(team.playerIds, LIMITS.players)) return 'tournament.bracket.teams[].playerIds is invalid';
  }
  return null;
}

function validateTimedMode(value: unknown): string | null {
  if (value === null) return null;
  if (!isPlainObject(value)) return 'tournament.timedMode must be an object or null';
  if (!isFiniteNumber(value.freePlayMinutes)) return 'tournament.timedMode.freePlayMinutes must be a number';
  if (!isFiniteNumber(value.draftSize)) return 'tournament.timedMode.draftSize must be a number';
  if (!isNullOr(value.timerStartedAt, isFiniteNumber)) {
    return 'tournament.timedMode.timerStartedAt must be a number or null';
  }
  if (!isNullOr(value.maxPartnerRepeats, isFiniteNumber)) {
    return 'tournament.timedMode.maxPartnerRepeats must be a number or null';
  }
  return null;
}

function validateTournament(value: unknown, expectedId: string): string | null {
  if (!isPlainObject(value)) return 'tournament must be an object';
  if (value.id !== expectedId) return 'tournament.id must match the tournament id in the URL';
  if (!isBoundedString(value.name)) return 'tournament.name is invalid';
  if (!isBoundedString(value.note, 10_000)) return 'tournament.note is invalid';
  if (!isFiniteNumber(value.createdAt)) return 'tournament.createdAt must be a number';
  if (!isFiniteNumber(value.updatedAt)) return 'tournament.updatedAt must be a number';
  if (!TOURNAMENT_PHASES.has(value.phase as string)) return 'tournament.phase is invalid';
  if (!TOURNAMENT_STATUSES.has(value.status as string)) return 'tournament.status is invalid';
  if (value.format !== null && value.format !== 'single_elim') return 'tournament.format is invalid';

  const eloError = validateEloSettings(value.elo);
  if (eloError) return eloError;
  const playError = validatePlaySettings(value.play);
  if (playError) return playError;
  const bracketError = validateBracket(value.bracket);
  if (bracketError) return bracketError;
  const timedModeError = validateTimedMode(value.timedMode);
  if (timedModeError) return timedModeError;

  if (value.clonedFrom !== null) {
    if (!isPlainObject(value.clonedFrom) || !isId(value.clonedFrom.tournamentId) || !isBoundedString(value.clonedFrom.name)) {
      return 'tournament.clonedFrom is invalid';
    }
  }
  if (!isNullOr(value.startedAt, isFiniteNumber)) return 'tournament.startedAt must be a number or null';
  if (!isNullOr(value.finishedAt, isFiniteNumber)) return 'tournament.finishedAt must be a number or null';
  // visibility is forced to 'public' by the server; whatever the client sends is ignored, not validated.
  return null;
}

function validatePlayer(value: unknown, tournamentId: string, seenIds: Set<string>): string | null {
  if (!isPlainObject(value)) return 'player must be an object';
  if (!isId(value.id)) return 'player.id is invalid';
  if (seenIds.has(value.id)) return `duplicate player id ${value.id}`;
  seenIds.add(value.id);
  if (value.tournamentId !== tournamentId) return `player.tournamentId does not match (${value.id})`;
  if (!isBoundedString(value.name)) return `player.name is invalid (${value.id})`;
  if (!isFiniteNumber(value.baseElo)) return `player.baseElo must be a number (${value.id})`;
  if (!isFiniteNumber(value.elo)) return `player.elo must be a number (${value.id})`;
  if (!isFiniteNumber(value.createdAt)) return `player.createdAt must be a number (${value.id})`;
  if (typeof value.active !== 'boolean') return `player.active must be a boolean (${value.id})`;
  if (typeof value.inTournament !== 'boolean') return `player.inTournament must be a boolean (${value.id})`;
  if (value.origin !== null) {
    if (!isPlainObject(value.origin) || !isId(value.origin.tournamentId) || !isId(value.origin.playerId)) {
      return `player.origin is invalid (${value.id})`;
    }
  }
  return null;
}

function validateMatchFeed(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (!isPlainObject(value)) return `${field} must be an object or null`;
  if (!isId(value.matchId)) return `${field}.matchId is invalid`;
  if (!SLOTS.has(value.slot as string)) return `${field}.slot is invalid`;
  return null;
}

function validateMatch(value: unknown, tournamentId: string, seenIds: Set<string>): string | null {
  if (!isPlainObject(value)) return 'match must be an object';
  if (!isId(value.id)) return 'match.id is invalid';
  if (seenIds.has(value.id)) return `duplicate match id ${value.id}`;
  seenIds.add(value.id);
  if (value.tournamentId !== tournamentId) return `match.tournamentId does not match (${value.id})`;
  if (!MATCH_STAGES.has(value.stage as string)) return `match.stage is invalid (${value.id})`;
  if (!isFiniteNumber(value.round)) return `match.round must be a number (${value.id})`;
  if (!isFiniteNumber(value.order)) return `match.order must be a number (${value.id})`;
  if (!isStringArray(value.teamA, LIMITS.players)) return `match.teamA is invalid (${value.id})`;
  if (!isStringArray(value.teamB, LIMITS.players)) return `match.teamB is invalid (${value.id})`;
  if (!isNullOr(value.scoreA, isFiniteNumber)) return `match.scoreA must be a number or null (${value.id})`;
  if (!isNullOr(value.scoreB, isFiniteNumber)) return `match.scoreB must be a number or null (${value.id})`;
  if (!MATCH_STATUSES.has(value.status as string)) return `match.status is invalid (${value.id})`;
  if (typeof value.bye !== 'boolean') return `match.bye must be a boolean (${value.id})`;
  if (!isFiniteNumber(value.createdAt)) return `match.createdAt must be a number (${value.id})`;
  if (!isNullOr(value.playedAt, isFiniteNumber)) return `match.playedAt must be a number or null (${value.id})`;
  if (!isFiniteNumber(value.sequence)) return `match.sequence must be a number (${value.id})`;
  const winnerError = validateMatchFeed(value.feedsWinnerTo, `match.feedsWinnerTo (${value.id})`);
  if (winnerError) return winnerError;
  const loserError = validateMatchFeed(value.feedsLoserTo, `match.feedsLoserTo (${value.id})`);
  if (loserError) return loserError;
  if (!isNullOr(value.labelA, (v) => isBoundedString(v))) return `match.labelA is invalid (${value.id})`;
  if (!isNullOr(value.labelB, (v) => isBoundedString(v))) return `match.labelB is invalid (${value.id})`;
  return null;
}

/** Validates a whole snapshot against `expectedTournamentId` (the id in the URL / the new id on create). */
export function validateSnapshot(value: unknown, expectedTournamentId: string): ValidationResult {
  if (!isId(expectedTournamentId)) return { ok: false, message: 'invalid tournament id' };
  if (!isPlainObject(value)) return { ok: false, message: 'snapshot must be an object' };

  const tournamentError = validateTournament(value.tournament, expectedTournamentId);
  if (tournamentError) return { ok: false, message: tournamentError };

  if (!Array.isArray(value.players) || value.players.length > LIMITS.players) {
    return { ok: false, message: 'players must be an array within the size limit' };
  }
  const playerIds = new Set<string>();
  for (const player of value.players) {
    const error = validatePlayer(player, expectedTournamentId, playerIds);
    if (error) return { ok: false, message: error };
  }

  if (!Array.isArray(value.matches) || value.matches.length > LIMITS.matches) {
    return { ok: false, message: 'matches must be an array within the size limit' };
  }
  const matchIds = new Set<string>();
  for (const match of value.matches) {
    const error = validateMatch(match, expectedTournamentId, matchIds);
    if (error) return { ok: false, message: error };
  }

  return { ok: true, snapshot: value as unknown as TournamentSnapshot };
}

/** Lowercase UUID v4-shaped string - the id doubles as the share secret, so it must be unguessable. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isValidTournamentId(id: string): boolean {
  return UUID_RE.test(id);
}
