/**
 * Thin wrapper over the wire contract (protocol.ts). Every function here maps
 * transport failures to SyncError itself; callers that need to branch on a
 * particular status (409 conflict, 403 locked, ...) get a typed result
 * instead of having to catch and inspect an error.
 */
import {
  API_ERROR_STATUS,
  PASSWORD_HEADER,
  PROTOCOL_VERSION,
  type ApiErrorBody,
  type CreateRequest,
  type CreateResponse,
  type FetchResponse,
  type HealthResponse,
  type PasswordRequest,
  type ProtectedReason,
  type PushRequest,
  type PushResponse,
  type TournamentSnapshot,
  type UnlockRequest,
} from './protocol';
import { SyncError } from './errors';
import { getSyncEnv } from './config';

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return !!value && typeof value === 'object' && typeof (value as { error?: unknown }).error === 'string';
}

type RawResult = { ok: true; status: number; data: unknown } | { ok: false; status: number; error: ApiErrorBody };

/**
 * Performs one request and classifies the outcome. Throws SyncError('offline')
 * for anything that never reached a server, and SyncError('unavailable') for
 * a response that is not this API - a 404 HTML page from a static host, an
 * empty body where JSON was expected, or a body without a recognisable error
 * shape. Everything else is returned for the caller to interpret, because
 * which status codes are expected differs per endpoint.
 */
async function rawRequest(method: string, path: string, body?: unknown, password?: string | null): Promise<RawResult> {
  const env = getSyncEnv();
  if (!env.isOnline()) throw new SyncError('offline');

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (password) headers[PASSWORD_HEADER] = password;

  let response: Response;
  try {
    response = await env.fetch(`${env.apiBase()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SyncError('offline');
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new SyncError('unavailable');
  }

  let json: unknown;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new SyncError('unavailable');
    }
  }

  if (response.ok) return { ok: true, status: response.status, data: json };
  if (!isApiErrorBody(json)) throw new SyncError('unavailable');
  return { ok: false, status: response.status, error: json };
}

/** Maps an API error this endpoint did not expect to a generic SyncError. */
function genericError(body: ApiErrorBody): SyncError {
  switch (body.error) {
    case 'locked':
      return new SyncError('locked', body.reasons ?? [], body.message);
    case 'not_found':
      return new SyncError('not_found', [], body.message);
    case 'deleted':
      return new SyncError('deleted', [], body.message);
    case 'bad_request':
    case 'too_large':
    case 'rate_limited':
    case 'exists':
    case 'conflict':
      return new SyncError('rejected', [], body.message);
    case 'internal':
    default:
      return new SyncError('unknown', [], body.message);
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    const result = await rawRequest('GET', '/health');
    if (!result.ok) return false;
    const data = result.data as Partial<HealthResponse> | undefined;
    return data?.ok === true && data.protocol === PROTOCOL_VERSION;
  } catch {
    return false;
  }
}

export type CreateResult =
  | { kind: 'created'; revision: number }
  | { kind: 'exists' };

export async function createTournament(snapshot: TournamentSnapshot, password: string | null): Promise<CreateResult> {
  const req: CreateRequest = { snapshot, password };
  const result = await rawRequest('POST', '/tournaments', req);
  if (result.ok) return { kind: 'created', revision: (result.data as CreateResponse).revision };
  if (result.error.error === 'exists') return { kind: 'exists' };
  throw genericError(result.error);
}

export interface FetchResult {
  revision: number;
  protected: boolean;
  snapshot: TournamentSnapshot;
}

/** Throws SyncError 'not_found' or 'deleted' as well as the transport errors. */
export async function fetchTournament(tournamentId: string): Promise<FetchResult> {
  const result = await rawRequest('GET', `/tournaments/${tournamentId}`);
  if (!result.ok) throw genericError(result.error);
  const data = result.data as FetchResponse;
  return { revision: data.revision, protected: data.protected, snapshot: data.snapshot };
}

export type PushResult =
  | { kind: 'ok'; revision: number }
  | { kind: 'conflict'; revision: number; applied: string[] }
  | { kind: 'locked'; reasons: ProtectedReason[] };

export async function pushTournament(
  tournamentId: string,
  request: PushRequest,
  password: string | null,
): Promise<PushResult> {
  const result = await rawRequest('PUT', `/tournaments/${tournamentId}`, request, password);
  if (result.ok) return { kind: 'ok', revision: (result.data as PushResponse).revision };
  if (result.error.error === 'conflict') {
    return { kind: 'conflict', revision: result.error.revision ?? 0, applied: result.error.applied ?? [] };
  }
  if (result.error.error === 'locked') return { kind: 'locked', reasons: result.error.reasons ?? [] };
  throw genericError(result.error);
}

/** Returns false for a wrong password (403); throws for anything else, including rate limiting. */
export async function unlockTournament(tournamentId: string, password: string): Promise<boolean> {
  const req: UnlockRequest = { password };
  const result = await rawRequest('POST', `/tournaments/${tournamentId}/unlock`, req);
  if (result.ok) return true;
  if (result.status === API_ERROR_STATUS.locked) return false;
  throw genericError(result.error);
}

/**
 * `current` must be the password remembered on this device. A 403 here means
 * it did not match what the server has, which is always a `wrong_password`,
 * never a generic `locked`: the caller is responsible for only attempting
 * this once it holds a password that unlocked the tournament.
 */
export async function setPassword(tournamentId: string, current: string | null, next: string | null): Promise<void> {
  const req: PasswordRequest = { current, next };
  const result = await rawRequest('PUT', `/tournaments/${tournamentId}/password`, req);
  if (result.ok) return;
  if (result.status === API_ERROR_STATUS.locked) throw new SyncError('wrong_password', [], result.error.message);
  throw genericError(result.error);
}

/** A 403 here means the password did not match; 404/410 are treated as already gone. */
export async function deleteTournament(tournamentId: string, password: string | null): Promise<void> {
  const result = await rawRequest('DELETE', `/tournaments/${tournamentId}`, undefined, password);
  if (result.ok) return;
  // Deleting twice is fine: the tournament is gone either way.
  if (result.error.error === 'not_found' || result.error.error === 'deleted') return;
  if (result.error.error === 'locked') throw new SyncError('locked', result.error.reasons ?? [], result.error.message);
  throw genericError(result.error);
}

export function eventsUrl(tournamentId: string): string {
  return `${getSyncEnv().apiBase()}/tournaments/${tournamentId}/events`;
}
