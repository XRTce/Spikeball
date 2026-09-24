/**
 * Wire contract between the app and the sync server (server/).
 *
 * Both sides import this file, so it must stay free of browser and Node APIs:
 * types and plain constants only. See docs/SYNC.md for the protocol in prose.
 */
import type { Match, Player, Tournament } from '../domain/types';
import type { ProtectedReason } from './protection';

export type { ProtectedReason } from './protection';

/** Bumped on incompatible changes; reported by GET /api/health. */
export const PROTOCOL_VERSION = 1;

/** Path prefix of every endpoint, relative to the API origin. */
export const API_PREFIX = '/api';

/** Carries the tournament's admin password on requests that may need it. */
export const PASSWORD_HEADER = 'X-Rally-Password';

export const LIMITS = {
  /** Largest accepted request body. A 30-player evening is well under 100 kB. */
  bodyBytes: 2_000_000,
  players: 500,
  matches: 5_000,
  /** Command ids per push; a longer offline queue is pushed in one go anyway. */
  commandIds: 1_000,
  passwordMin: 4,
  passwordMax: 128,
} as const;

/** Everything that makes up one tournament, as stored on the server. */
export interface TournamentSnapshot {
  tournament: Tournament;
  players: Player[];
  matches: Match[];
}

/**
 * Repo mutations that can be queued for a public tournament. The name is the
 * exported function name in src/db/repo.ts; replay looks it up by this name.
 */
export type CommandName =
  | 'renameTournament'
  | 'updateTournament'
  | 'addPlayer'
  | 'updatePlayer'
  | 'deletePlayer'
  | 'clonePlayersFrom'
  | 'scheduleCasualMatch'
  | 'recordCasualResult'
  | 'setMatchResult'
  | 'clearMatchResult'
  | 'deleteMatch'
  | 'swapMatchPlayers'
  | 'startFreePlayTimer'
  | 'startDraftedBracket'
  | 'finishTournament'
  | 'reopenTournament'
  | 'backToCasual';

/* ------------------------------------------------------------------------ */
/* Endpoints                                                                  */
/* ------------------------------------------------------------------------ */

/** GET /api/health -> 200 */
export interface HealthResponse {
  ok: true;
  protocol: number;
}

/**
 * POST /api/tournaments -> 201 CreateResponse | 409 exists | 400 | 413
 *
 * The id is the snapshot's tournament id. It doubles as the share secret, so
 * the client generates it with crypto.randomUUID().
 */
export interface CreateRequest {
  snapshot: TournamentSnapshot;
  /** Optional admin password; null = anyone with the link may do anything. */
  password: string | null;
}

export interface CreateResponse {
  revision: number;
}

/** GET /api/tournaments/:id -> 200 FetchResponse | 404 not_found | 410 deleted */
export interface FetchResponse {
  revision: number;
  /** Whether an admin password is set. The password itself never leaves the server. */
  protected: boolean;
  snapshot: TournamentSnapshot;
}

/**
 * PUT /api/tournaments/:id (optional PASSWORD_HEADER)
 *   -> 200 PushResponse
 *   -> 409 conflict (baseRevision is stale; `revision` and `applied` are set)
 *   -> 403 locked   (the change needs the password; `reasons` is set)
 *   -> 404 / 410 / 400 / 413
 *
 * Compare-and-swap: accepted only if baseRevision equals the stored revision.
 */
export interface PushRequest {
  baseRevision: number;
  /**
   * Ids of the pending commands this snapshot contains. Recorded on success,
   * so a push whose response was lost is recognised on retry.
   */
  commandIds: string[];
  snapshot: TournamentSnapshot;
}

export interface PushResponse {
  revision: number;
}

/** POST /api/tournaments/:id/unlock -> 204 | 403 locked | 429 rate_limited */
export interface UnlockRequest {
  password: string;
}

/**
 * PUT /api/tournaments/:id/password -> 204 | 403 locked | 400 | 429
 *
 * `current` must match when a password is set. `next: null` removes it.
 */
export interface PasswordRequest {
  current: string | null;
  next: string | null;
}

/** DELETE /api/tournaments/:id (PASSWORD_HEADER when protected) -> 204 | 403 locked */

/**
 * GET /api/tournaments/:id/events -> text/event-stream
 *
 * `event: state` with StateEvent data, sent once on connect and again after
 * every accepted push or password change. `event: deleted` with `{}` when the
 * tournament is deleted; the server then closes the stream. Comment lines
 * (`: ping`) keep idle connections open through proxies.
 */
export interface StateEvent {
  revision: number;
  protected: boolean;
}

/* ------------------------------------------------------------------------ */
/* Errors                                                                     */
/* ------------------------------------------------------------------------ */

export type ApiErrorCode =
  | 'bad_request'
  | 'locked'
  | 'not_found'
  | 'exists'
  | 'conflict'
  | 'deleted'
  | 'too_large'
  | 'rate_limited'
  | 'internal';

export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  locked: 403,
  not_found: 404,
  exists: 409,
  conflict: 409,
  deleted: 410,
  too_large: 413,
  rate_limited: 429,
  internal: 500,
};

/** Body of every non-2xx response. */
export interface ApiErrorBody {
  error: ApiErrorCode;
  /** Developer-facing detail, English. The UI maps `error` to German text. */
  message?: string;
  /** conflict: the server's current revision. */
  revision?: number;
  /** conflict: which of the pushed commandIds the server has already applied. */
  applied?: string[];
  /** locked: what in the change needs the password. */
  reasons?: ProtectedReason[];
}

/**
 * Why a sync attempt for a tournament failed, as shown by the status badge.
 * `offline`: no network. `unavailable`: network fine, but no sync server
 * answers (for example the GitHub Pages build). `locked`: the server refused
 * a queued change without the password. `rejected`: the server refused a
 * change as invalid.
 */
export type SyncErrorCode =
  | 'offline'
  | 'unavailable'
  | 'locked'
  | 'not_found'
  | 'deleted'
  | 'rejected'
  | 'unknown';
