/**
 * HTTP application: routes every endpoint in src/sync/protocol.ts to the
 * store, the password/rate-limit checks and the SSE hub. `createApp` returns
 * a plain `http.Server` plus the pieces a test needs direct access to (the
 * store, for an in-memory DB; a fake clock).
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import {
  API_ERROR_STATUS,
  API_PREFIX,
  LIMITS,
  PASSWORD_HEADER,
  PROTOCOL_VERSION,
  type ApiErrorBody,
  type ApiErrorCode,
  type CreateRequest,
  type CreateResponse,
  type FetchResponse,
  type PasswordRequest,
  type PushRequest,
  type PushResponse,
  type StateEvent,
  type TournamentSnapshot,
  type UnlockRequest,
} from '../src/sync/protocol';
import { protectedChanges, type ProtectionInput } from '../src/sync/protection';
import { Store } from './store';
import { EventHub } from './events';
import { RateLimiter } from './rateLimit';
import { hashPassword, verifyPassword } from './password';
import { isValidTournamentId, validateSnapshot } from './validate';
import { StaticServer } from './static';

export interface AppOptions {
  /** SQLite file path, or ':memory:' for tests. */
  dbPath: string;
  /** Built PWA to serve, or null/missing to run API-only. */
  staticDir?: string | null;
  /** Cross-origin app origin allowed to call the API, '*' for any, unset = same-origin only. */
  corsOrigin?: string | null;
  /** Trust X-Forwarded-For for the rate limiter's client key. */
  trustProxy?: boolean;
  retentionDays?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
  /** How often to sweep stale tournaments; exposed for tests, defaults to 24h. */
  retentionIntervalMs?: number;
}

export interface App {
  server: Server;
  store: Store;
  hub: EventHub;
  close(): Promise<void>;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_RETENTION_DAYS = 365;

const ALLOWED_API_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const ALLOWED_API_HEADERS = `Content-Type, ${PASSWORD_HEADER}`;

export function createApp(options: AppOptions): App {
  const now = options.now ?? Date.now;
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const trustProxy = options.trustProxy ?? false;
  const corsOrigin = options.corsOrigin ?? null;

  const store = new Store(options.dbPath);
  const hub = new EventHub();
  const rateLimiter = new RateLimiter(10, 10 * 60 * 1000, now);
  const staticServer = new StaticServer(options.staticDir ?? null);

  function runRetentionSweep(): void {
    const cutoff = now() - retentionDays * DAY_MS;
    const nowMs = now();
    const tombstoned = store.tombstoneStale(cutoff, nowMs);
    for (const id of tombstoned) hub.broadcastDeleted(id);
    store.purgeTombstones(cutoff);
  }
  runRetentionSweep();
  const retentionTimer = setInterval(runRetentionSweep, options.retentionIntervalMs ?? DAY_MS);
  retentionTimer.unref();
  const sweepTimer = setInterval(() => rateLimiter.sweep(), HOUR_MS);
  sweepTimer.unref();

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => {
      console.error('unhandled request error', error);
      if (!res.headersSent) sendError(res, 'internal');
      else res.end();
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://internal').pathname);
    } catch {
      sendError(res, 'bad_request', 'malformed URL');
      return;
    }

    if (pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)) {
      applyCors(req, res, corsOrigin);
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      await routeApi(req, res, pathname);
      return;
    }

    if (staticServer.handle(req, res, pathname)) return;
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not Found');
  }

  async function routeApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    if (pathname === '/api/health') {
      if (req.method !== 'GET') return sendError(res, 'bad_request', 'method not allowed');
      const body: { ok: true; protocol: number } = { ok: true, protocol: PROTOCOL_VERSION };
      return sendJson(res, 200, body);
    }

    if (pathname === '/api/tournaments') {
      if (req.method !== 'POST') return sendError(res, 'bad_request', 'method not allowed');
      return handleCreate(req, res);
    }

    const idMatch = pathname.match(/^\/api\/tournaments\/([^/]+)$/);
    if (idMatch) {
      const id = idMatch[1]!;
      if (req.method === 'GET') return handleFetch(res, id);
      if (req.method === 'PUT') return handlePush(req, res, id);
      if (req.method === 'DELETE') return handleDelete(req, res, id);
      return sendError(res, 'bad_request', 'method not allowed');
    }

    const subMatch = pathname.match(/^\/api\/tournaments\/([^/]+)\/(unlock|password|events)$/);
    if (subMatch) {
      const id = subMatch[1]!;
      const action = subMatch[2]!;
      if (action === 'unlock' && req.method === 'POST') return handleUnlock(req, res, id);
      if (action === 'password' && req.method === 'PUT') return handlePassword(req, res, id);
      if (action === 'events' && req.method === 'GET') return handleEvents(res, id);
      return sendError(res, 'bad_request', 'method not allowed');
    }

    sendError(res, 'not_found');
  }

  async function handleCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody<Partial<CreateRequest>>(req, res);
    if (body === undefined) return;

    if (body.password !== null && typeof body.password !== 'string') {
      return sendError(res, 'bad_request', 'password must be a string or null');
    }
    if (typeof body.password === 'string' && (body.password.length < LIMITS.passwordMin || body.password.length > LIMITS.passwordMax)) {
      return sendError(res, 'bad_request', `password must be ${LIMITS.passwordMin}-${LIMITS.passwordMax} characters`);
    }

    const snapshotValue = body.snapshot as { tournament?: { id?: unknown } } | undefined;
    const id = snapshotValue?.tournament?.id;
    if (typeof id !== 'string' || !isValidTournamentId(id)) {
      return sendError(res, 'bad_request', 'snapshot.tournament.id must be a lowercase UUID');
    }

    const validation = validateSnapshot(body.snapshot, id);
    if (!validation.ok) return sendError(res, 'bad_request', validation.message);

    if (store.exists(id)) return sendError(res, 'exists');

    const snapshot = forcePublic(validation.snapshot);
    const passwordHash = typeof body.password === 'string' ? hashPassword(body.password) : null;
    const nowMs = now();
    // node:sqlite is synchronous and nothing awaits between the `exists`
    // check above and this insert, so no other request can interleave here.
    store.transaction(() => store.insert(id, snapshot, passwordHash, nowMs));

    const response: CreateResponse = { revision: 1 };
    sendJson(res, 201, response);
  }

  async function handleFetch(res: ServerResponse, id: string): Promise<void> {
    const row = store.get(id);
    if (!row) return sendError(res, 'not_found');
    if (row.deletedAt !== null || !row.snapshot) return sendError(res, 'deleted');
    const response: FetchResponse = {
      revision: row.revision,
      protected: row.passwordHash !== null,
      snapshot: row.snapshot,
    };
    sendJson(res, 200, response);
  }

  async function handlePush(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const body = await readJsonBody<Partial<PushRequest>>(req, res);
    if (body === undefined) return;

    if (typeof body.baseRevision !== 'number' || !Number.isFinite(body.baseRevision)) {
      return sendError(res, 'bad_request', 'baseRevision must be a number');
    }
    if (!Array.isArray(body.commandIds) || body.commandIds.length > LIMITS.commandIds || !body.commandIds.every((c) => typeof c === 'string')) {
      return sendError(res, 'bad_request', 'commandIds must be an array of strings');
    }

    const row = store.get(id);
    if (!row) return sendError(res, 'not_found');
    if (row.deletedAt !== null || !row.snapshot) return sendError(res, 'deleted');

    const validation = validateSnapshot(body.snapshot, id);
    if (!validation.ok) return sendError(res, 'bad_request', validation.message);
    const snapshot = forcePublic(validation.snapshot);
    const commandIds = body.commandIds;
    const baseRevision = body.baseRevision;
    const passwordHeader = readPasswordHeader(req);
    const rateKey = `${clientKey(req, trustProxy)}:${id}`;
    const nowMs = now();

    type Outcome =
      | { kind: 'conflict'; revision: number; applied: string[] }
      | { kind: 'locked'; reasons: ReturnType<typeof protectedChanges> }
      | { kind: 'rate_limited' }
      | { kind: 'ok'; revision: number; protected: boolean };

    const outcome = store.transaction<Outcome>(() => {
      // Re-reading here is cheap and keeps this block self-contained; nothing
      // async happens between the outer check and this transaction, so
      // `current` cannot actually differ from `row` above.
      const current = store.get(id)!;
      if (baseRevision !== current.revision) {
        return { kind: 'conflict', revision: current.revision, applied: store.appliedOf(id, commandIds) };
      }

      // current.snapshot is non-null: the outer check above already ruled out
      // a tombstoned row, and nothing async happens in between.
      const reasons = protectedChanges(toProtectionInput(current.snapshot!), toProtectionInput(snapshot));
      if (reasons.length > 0 && current.passwordHash) {
        if (rateLimiter.isBlocked(rateKey)) return { kind: 'rate_limited' };
        if (!passwordHeader || !verifyPassword(passwordHeader, current.passwordHash)) {
          rateLimiter.recordFailure(rateKey);
          return { kind: 'locked', reasons };
        }
        rateLimiter.clear(rateKey);
      }

      const revision = store.push(id, snapshot, commandIds, nowMs);
      return { kind: 'ok', revision, protected: current.passwordHash !== null };
    });

    if (outcome.kind === 'conflict') {
      return sendError(res, 'conflict', undefined, { revision: outcome.revision, applied: outcome.applied });
    }
    if (outcome.kind === 'rate_limited') return sendError(res, 'rate_limited');
    if (outcome.kind === 'locked') return sendError(res, 'locked', undefined, { reasons: outcome.reasons });

    const response: PushResponse = { revision: outcome.revision };
    sendJson(res, 200, response);
    hub.broadcastState(id, { revision: outcome.revision, protected: outcome.protected });
  }

  async function handleUnlock(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const body = await readJsonBody<Partial<UnlockRequest>>(req, res);
    if (body === undefined) return;
    if (typeof body.password !== 'string') return sendError(res, 'bad_request', 'password must be a string');

    const row = store.get(id);
    if (!row) return sendError(res, 'not_found');
    if (row.deletedAt !== null) return sendError(res, 'deleted');

    if (row.passwordHash === null) {
      res.statusCode = 204;
      res.end();
      return;
    }

    const rateKey = `${clientKey(req, trustProxy)}:${id}`;
    if (rateLimiter.isBlocked(rateKey)) return sendError(res, 'rate_limited');
    if (!verifyPassword(body.password, row.passwordHash)) {
      rateLimiter.recordFailure(rateKey);
      return sendError(res, 'locked', undefined, { reasons: ['password'] });
    }
    rateLimiter.clear(rateKey);
    res.statusCode = 204;
    res.end();
  }

  async function handlePassword(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const body = await readJsonBody<Partial<PasswordRequest>>(req, res);
    if (body === undefined) return;
    if (body.current !== null && typeof body.current !== 'string') {
      return sendError(res, 'bad_request', 'current must be a string or null');
    }
    if (body.next !== null && typeof body.next !== 'string') {
      return sendError(res, 'bad_request', 'next must be a string or null');
    }
    if (typeof body.next === 'string' && (body.next.length < LIMITS.passwordMin || body.next.length > LIMITS.passwordMax)) {
      return sendError(res, 'bad_request', `next must be ${LIMITS.passwordMin}-${LIMITS.passwordMax} characters`);
    }

    const row = store.get(id);
    if (!row) return sendError(res, 'not_found');
    if (row.deletedAt !== null) return sendError(res, 'deleted');

    if (row.passwordHash !== null) {
      const rateKey = `${clientKey(req, trustProxy)}:${id}`;
      if (rateLimiter.isBlocked(rateKey)) return sendError(res, 'rate_limited');
      if (!body.current || !verifyPassword(body.current, row.passwordHash)) {
        rateLimiter.recordFailure(rateKey);
        return sendError(res, 'locked', undefined, { reasons: ['password'] });
      }
      rateLimiter.clear(rateKey);
    }

    const newHash = typeof body.next === 'string' ? hashPassword(body.next) : null;
    const nowMs = now();
    store.transaction(() => store.setPasswordHash(id, newHash, nowMs));

    res.statusCode = 204;
    res.end();
    const current = store.get(id)!;
    hub.broadcastState(id, { revision: current.revision, protected: newHash !== null });
  }

  async function handleDelete(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const row = store.get(id);
    if (!row) return sendError(res, 'not_found');
    if (row.deletedAt !== null) return sendError(res, 'deleted');

    if (row.passwordHash !== null) {
      const rateKey = `${clientKey(req, trustProxy)}:${id}`;
      if (rateLimiter.isBlocked(rateKey)) return sendError(res, 'rate_limited');
      const passwordHeader = readPasswordHeader(req);
      if (!passwordHeader || !verifyPassword(passwordHeader, row.passwordHash)) {
        rateLimiter.recordFailure(rateKey);
        return sendError(res, 'locked', undefined, { reasons: ['delete_tournament'] });
      }
      rateLimiter.clear(rateKey);
    }

    const nowMs = now();
    store.transaction(() => store.tombstone(id, nowMs));
    res.statusCode = 204;
    res.end();
    hub.broadcastDeleted(id);
  }

  async function handleEvents(res: ServerResponse, id: string): Promise<void> {
    const row = store.get(id);
    if (!row) return sendError(res, 'not_found');
    if (row.deletedAt !== null) return sendError(res, 'deleted');
    if (hub.atCapacity(id)) return sendError(res, 'rate_limited', 'too many viewers of this tournament');

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    res.write('retry: 5000\n\n');

    const state: StateEvent = { revision: row.revision, protected: row.passwordHash !== null };
    hub.sendState(res, state);
    hub.subscribe(id, res);
  }

  return {
    server,
    store,
    hub,
    close: () =>
      new Promise<void>((resolve, reject) => {
        clearInterval(retentionTimer);
        clearInterval(sweepTimer);
        server.close((error) => {
          store.close();
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function forcePublic(snapshot: TournamentSnapshot): TournamentSnapshot {
  if (snapshot.tournament.visibility === 'public') return snapshot;
  return { ...snapshot, tournament: { ...snapshot.tournament, visibility: 'public' } };
}

function toProtectionInput(snapshot: TournamentSnapshot): ProtectionInput {
  return {
    tournament: snapshot.tournament,
    players: snapshot.players.map((player) => ({ id: player.id, baseElo: player.baseElo })),
    matches: snapshot.matches,
  };
}

function readPasswordHeader(req: IncomingMessage): string | null {
  const value = req.headers[PASSWORD_HEADER.toLowerCase()];
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

function clientKey(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
    if (first && first.trim().length > 0) return first.trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function applyCors(req: IncomingMessage, res: ServerResponse, corsOrigin: string | null): void {
  if (!corsOrigin) return;
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  if (corsOrigin !== '*') res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_API_METHODS);
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_API_HEADERS);
  void req;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', payload.length);
  res.end(payload);
}

function sendError(
  res: ServerResponse,
  error: ApiErrorCode,
  message?: string,
  extra?: Partial<Pick<ApiErrorBody, 'revision' | 'applied' | 'reasons'>>,
): void {
  const body: ApiErrorBody = { error, ...(message ? { message } : {}), ...extra };
  sendJson(res, API_ERROR_STATUS[error], body);
}

/**
 * Reads and JSON-parses the request body, capped at LIMITS.bodyBytes without
 * buffering an over-limit body in full. Writes the error response itself and
 * returns undefined when the body could not be used, so callers can
 * `if (body === undefined) return;` and otherwise trust the parsed value's
 * JSON shape (though not yet its domain validity).
 */
async function readJsonBody<T>(req: IncomingMessage, res: ServerResponse): Promise<T | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = false;

  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      total += chunk.length;
      if (total > LIMITS.bodyBytes) {
        tooLarge = true;
        req.destroy();
        resolve();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', resolve);
    req.on('error', reject);
    req.on('aborted', resolve);
  });

  if (tooLarge) {
    sendError(res, 'too_large');
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) {
    sendError(res, 'bad_request', 'empty body');
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    sendError(res, 'bad_request', 'invalid JSON');
    return undefined;
  }
}
