/**
 * An in-memory implementation of the wire contract in src/sync/protocol.ts,
 * used as the `fetch` implementation in tests (via configureSync). The real
 * server lives in server/ and is being built elsewhere; this only has to
 * follow the same protocol, not share code with it.
 */
import {
  API_ERROR_STATUS,
  PASSWORD_HEADER,
  PROTOCOL_VERSION,
  type ApiErrorBody,
  type ApiErrorCode,
  type CreateRequest,
  type PasswordRequest,
  type PushRequest,
  type TournamentSnapshot,
  type UnlockRequest,
} from '../../src/sync/protocol';
import { protectedChanges, type ProtectionInput } from '../../src/sync/protection';

export const FAKE_API_BASE = 'http://fake.rally.local/api';

interface Stored {
  revision: number;
  snapshot: TournamentSnapshot;
  passwordHash: string | null;
  createdAt: number;
  deleted: boolean;
  /** commandId -> revision it was accepted at, for idempotent retries. */
  appliedCommandIds: Map<string, number>;
  /** Set by tests to make /unlock and push answer 429, as the real rate limiter would. */
  rateLimited: boolean;
}

function toProtectionInput(snapshot: TournamentSnapshot): ProtectionInput {
  return {
    tournament: snapshot.tournament,
    players: snapshot.players.map((player) => ({ id: player.id, baseElo: player.baseElo })),
    matches: snapshot.matches,
  };
}

function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: ApiErrorCode, extra?: Partial<ApiErrorBody>): Response {
  return respond(API_ERROR_STATUS[code], { error: code, ...extra });
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found ? found[1] : null;
  }
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? (headers as Record<string, string>)[key]! : null;
}

export interface FakeServer {
  /** Pass as `fetch` to configureSync(). */
  fetch: typeof fetch;
  reset(): void;
  has(tournamentId: string): boolean;
  getRevision(tournamentId: string): number;
  getSnapshot(tournamentId: string): TournamentSnapshot | undefined;
  isProtected(tournamentId: string): boolean;
  /** Simulates another device successfully pushing an accepted change. Returns the new revision. */
  pushAsOtherDevice(
    tournamentId: string,
    mutate: (snapshot: TournamentSnapshot) => TournamentSnapshot,
    password?: string | null,
  ): number;
  /** Simulates the tournament being deleted by another device or an admin. */
  deleteAsOtherDevice(tournamentId: string): void;
  /** Makes /unlock and push answer 429 rate_limited (on), or stop doing so (off). */
  setRateLimited(tournamentId: string, on: boolean): void;
}

export function createFakeServer(): FakeServer {
  const store = new Map<string, Stored>();

  function requireStored(id: string): Stored {
    const stored = store.get(id);
    if (!stored) throw new Error(`fakeServer: unknown tournament ${id}`);
    return stored;
  }

  function handleCreate(body: CreateRequest): Response {
    const id = body.snapshot.tournament.id;
    const existing = store.get(id);
    if (existing) return errorResponse('exists');
    store.set(id, {
      revision: 1,
      snapshot: body.snapshot,
      passwordHash: body.password,
      createdAt: body.snapshot.tournament.createdAt,
      deleted: false,
      appliedCommandIds: new Map(),
      rateLimited: false,
    });
    return respond(201, { revision: 1 });
  }

  function handleFetch(id: string): Response {
    const stored = store.get(id);
    if (!stored) return errorResponse('not_found');
    if (stored.deleted) return errorResponse('deleted');
    return respond(200, { revision: stored.revision, protected: stored.passwordHash != null, snapshot: stored.snapshot });
  }

  function handlePush(id: string, body: PushRequest, password: string | null): Response {
    const stored = store.get(id);
    if (!stored) return errorResponse('not_found');
    if (stored.deleted) return errorResponse('deleted');
    if (stored.rateLimited) return errorResponse('rate_limited');

    const reasons = protectedChanges(toProtectionInput(stored.snapshot), toProtectionInput(body.snapshot));
    if (stored.passwordHash != null && reasons.length > 0 && password !== stored.passwordHash) {
      return errorResponse('locked', { reasons });
    }

    if (body.baseRevision !== stored.revision) {
      const applied = body.commandIds.filter((cid) => stored.appliedCommandIds.has(cid));
      return errorResponse('conflict', { revision: stored.revision, applied });
    }

    const nextRevision = stored.revision + 1;
    for (const cid of body.commandIds) stored.appliedCommandIds.set(cid, nextRevision);
    stored.snapshot = body.snapshot;
    stored.revision = nextRevision;
    return respond(200, { revision: nextRevision });
  }

  function handleUnlock(id: string, body: UnlockRequest): Response {
    const stored = store.get(id);
    if (!stored) return errorResponse('not_found');
    if (stored.deleted) return errorResponse('deleted');
    if (stored.rateLimited) return errorResponse('rate_limited');
    if (stored.passwordHash != null && body.password !== stored.passwordHash) return errorResponse('locked');
    return respond(204);
  }

  function handlePassword(id: string, body: PasswordRequest): Response {
    const stored = store.get(id);
    if (!stored) return errorResponse('not_found');
    if (stored.deleted) return errorResponse('deleted');
    if (stored.passwordHash != body.current) return errorResponse('locked', { reasons: ['password'] });
    stored.passwordHash = body.next;
    return respond(204);
  }

  function handleDelete(id: string, password: string | null): Response {
    const stored = store.get(id);
    if (!stored) return errorResponse('not_found');
    if (stored.deleted) return respond(204); // idempotent
    if (stored.passwordHash != null && password !== stored.passwordHash) {
      return errorResponse('locked', { reasons: ['delete_tournament'] });
    }
    stored.deleted = true;
    return respond(204);
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const url = new URL(rawUrl);
    const method = (init?.method ?? 'GET').toUpperCase();
    const apiIndex = url.pathname.indexOf('/api');
    const path = apiIndex >= 0 ? url.pathname.slice(apiIndex + '/api'.length) : url.pathname;
    const password = headerValue(init?.headers, PASSWORD_HEADER);
    const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;

    if (path === '/health' && method === 'GET') return respond(200, { ok: true, protocol: PROTOCOL_VERSION });
    if (path === '/tournaments' && method === 'POST') return handleCreate(body as CreateRequest);

    let match = /^\/tournaments\/([^/]+)\/unlock$/.exec(path);
    if (match && method === 'POST') return handleUnlock(match[1]!, body as UnlockRequest);

    match = /^\/tournaments\/([^/]+)\/password$/.exec(path);
    if (match && method === 'PUT') return handlePassword(match[1]!, body as PasswordRequest);

    match = /^\/tournaments\/([^/]+)$/.exec(path);
    if (match) {
      if (method === 'GET') return handleFetch(match[1]!);
      if (method === 'PUT') return handlePush(match[1]!, body as PushRequest, password);
      if (method === 'DELETE') return handleDelete(match[1]!, password);
    }

    return errorResponse('not_found');
  };

  return {
    fetch: fetchImpl,
    reset() {
      store.clear();
    },
    has(id) {
      return store.has(id) && !store.get(id)!.deleted;
    },
    getRevision(id) {
      return requireStored(id).revision;
    },
    getSnapshot(id) {
      return store.get(id)?.snapshot;
    },
    isProtected(id) {
      return requireStored(id).passwordHash != null;
    },
    pushAsOtherDevice(id, mutate, password = null) {
      const stored = requireStored(id);
      const before = stored.snapshot;
      const after = mutate(structuredClone(before));
      const reasons = protectedChanges(toProtectionInput(before), toProtectionInput(after));
      if (stored.passwordHash != null && reasons.length > 0 && password !== stored.passwordHash) {
        throw new Error('fakeServer.pushAsOtherDevice: this change needs the password');
      }
      stored.snapshot = after;
      stored.revision += 1;
      return stored.revision;
    },
    deleteAsOtherDevice(id) {
      requireStored(id).deleted = true;
    },
    setRateLimited(id, on) {
      requireStored(id).rateLimited = on;
    },
  };
}
