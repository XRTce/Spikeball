import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../server/app';
import { PASSWORD_HEADER, type ApiErrorBody, type TournamentSnapshot } from '../src/sync/protocol';
import { makePlayer, makeTournament, playedMatch } from './helpers';

/* -------------------------------------------------------------------------- */
/* Test scaffolding                                                            */
/* -------------------------------------------------------------------------- */

let app: App | null = null;
let baseUrl = '';

function start(options: Partial<Parameters<typeof createApp>[0]> = {}): App {
  app = createApp({ dbPath: ':memory:', staticDir: null, retentionIntervalMs: 24 * 60 * 60 * 1000, ...options });
  app.server.listen(0);
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind a port');
  baseUrl = `http://127.0.0.1:${address.port}`;
  return app;
}

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

function snapshotFor(id: string, overrides: Partial<TournamentSnapshot> = {}): TournamentSnapshot {
  return {
    tournament: makeTournament({ id, visibility: 'public' }),
    players: [],
    matches: [],
    ...overrides,
  };
}

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function createTournament(
  snapshot: TournamentSnapshot,
  password: string | null = null,
): Promise<{ status: number; body: unknown }> {
  return api('/api/tournaments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot, password }),
  });
}

async function push(
  id: string,
  baseRevision: number,
  commandIds: string[],
  snapshot: TournamentSnapshot,
  password?: string,
): Promise<{ status: number; body: unknown }> {
  return api(`/api/tournaments/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(password ? { [PASSWORD_HEADER]: password } : {}) },
    body: JSON.stringify({ baseRevision, commandIds, snapshot }),
  });
}

/* -------------------------------------------------------------------------- */
/* Health, create, fetch                                                       */
/* -------------------------------------------------------------------------- */

describe('health', () => {
  it('reports ok and the protocol version', async () => {
    start();
    const res = await api('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, protocol: 1 });
  });
});

describe('create', () => {
  beforeEach(() => start());

  it('accepts a valid snapshot and returns revision 1', async () => {
    const id = randomUUID();
    const res = await createTournament(snapshotFor(id));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ revision: 1 });
  });

  it('rejects a duplicate id with 409 exists', async () => {
    const id = randomUUID();
    await createTournament(snapshotFor(id));
    const res = await createTournament(snapshotFor(id));
    expect(res.status).toBe(409);
    expect((res.body as ApiErrorBody).error).toBe('exists');
  });

  it('rejects a non-UUID tournament id', async () => {
    const res = await createTournament(snapshotFor('not-a-uuid'));
    expect(res.status).toBe(400);
    expect((res.body as ApiErrorBody).error).toBe('bad_request');
  });

  it('rejects a malformed body', async () => {
    const res = await api('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect((res.body as ApiErrorBody).error).toBe('bad_request');
  });

  it('rejects a body over the size limit with 413', async () => {
    const id = randomUUID();
    const snapshot = snapshotFor(id, { players: [] });
    const huge = JSON.stringify({ snapshot, password: null }) + 'x'.repeat(2_100_000);
    const res = await api('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: huge,
    });
    expect(res.status).toBe(413);
    expect((res.body as ApiErrorBody).error).toBe('too_large');
  });

  it('forces visibility to public regardless of what the client sends', async () => {
    const id = randomUUID();
    await createTournament(snapshotFor(id, { tournament: makeTournament({ id, visibility: 'local' }) }));
    const res = await api(`/api/tournaments/${id}`);
    expect((res.body as { snapshot: TournamentSnapshot }).snapshot.tournament.visibility).toBe('public');
  });
});

describe('fetch', () => {
  beforeEach(() => start());

  it('returns the stored snapshot', async () => {
    const id = randomUUID();
    await createTournament(snapshotFor(id));
    const res = await api(`/api/tournaments/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ revision: 1, protected: false });
  });

  it('404s for an unknown id', async () => {
    const res = await api(`/api/tournaments/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect((res.body as ApiErrorBody).error).toBe('not_found');
  });

  it('410s for a deleted tournament', async () => {
    const id = randomUUID();
    await createTournament(snapshotFor(id));
    await api(`/api/tournaments/${id}`, { method: 'DELETE' });
    const res = await api(`/api/tournaments/${id}`);
    expect(res.status).toBe(410);
    expect((res.body as ApiErrorBody).error).toBe('deleted');
  });
});

/* -------------------------------------------------------------------------- */
/* Push: happy path, conflict, idempotent retry                                */
/* -------------------------------------------------------------------------- */

describe('push', () => {
  beforeEach(() => start());

  it('accepts a push at the right baseRevision and bumps the revision', async () => {
    const id = randomUUID();
    await createTournament(snapshotFor(id));
    const renamed = snapshotFor(id, { tournament: makeTournament({ id, name: 'Neuer Name', visibility: 'public' }) });
    const res = await push(id, 1, ['c1'], renamed);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revision: 2 });
  });

  it('reports a conflict with the current revision and applied commandIds', async () => {
    const id = randomUUID();
    await createTournament(snapshotFor(id));
    await push(id, 1, ['c1'], snapshotFor(id, { tournament: makeTournament({ id, name: 'A', visibility: 'public' }) }));

    // A second client still thinks the revision is 1 and pushes its own commands.
    const res = await push(id, 1, ['c2'], snapshotFor(id, { tournament: makeTournament({ id, name: 'B', visibility: 'public' }) }));
    expect(res.status).toBe(409);
    const body = res.body as ApiErrorBody;
    expect(body.error).toBe('conflict');
    expect(body.revision).toBe(2);
    expect(body.applied).toEqual([]);
  });

  it('recognises a retried push whose response was lost', async () => {
    const id = randomUUID();
    await createTournament(snapshotFor(id));
    const first = snapshotFor(id, { tournament: makeTournament({ id, name: 'A', visibility: 'public' }) });
    const accepted = await push(id, 1, ['c1', 'c2'], first);
    expect(accepted.status).toBe(200);

    // The client never saw the 200 and retries with the same baseRevision.
    const retry = await push(id, 1, ['c1', 'c2'], first);
    expect(retry.status).toBe(409);
    const body = retry.body as ApiErrorBody;
    expect(body.revision).toBe(2);
    expect((body.applied ?? []).slice().sort()).toEqual(['c1', 'c2']);
  });

  it('404s / 410s for an unknown or deleted tournament', async () => {
    const missing = await push(randomUUID(), 1, [], snapshotFor(randomUUID()));
    expect(missing.status).toBe(404);

    const id = randomUUID();
    await createTournament(snapshotFor(id));
    await api(`/api/tournaments/${id}`, { method: 'DELETE' });
    const deleted = await push(id, 1, [], snapshotFor(id));
    expect(deleted.status).toBe(410);
  });

  it('rejects an invalid snapshot with 400', async () => {
    const id = randomUUID();
    await createTournament(snapshotFor(id));
    const bad = { ...snapshotFor(id), tournament: { id } }; // missing required fields
    const res = await push(id, 1, ['c1'], bad as unknown as TournamentSnapshot);
    expect(res.status).toBe(400);
  });
});

/* -------------------------------------------------------------------------- */
/* The password lock                                                           */
/* -------------------------------------------------------------------------- */

describe('locked changes', () => {
  beforeEach(() => start());

  async function seedProtected() {
    const id = randomUUID();
    const alice = makePlayer('alice');
    const bob = makePlayer('bob');
    alice.tournamentId = id;
    bob.tournamentId = id;
    const snapshot = snapshotFor(id, { players: [alice, bob] });
    await createTournament(snapshot, 'geheim1');
    return { id, snapshot, alice, bob };
  }

  it('refuses to delete a player without the password', async () => {
    const { id, snapshot, bob } = await seedProtected();
    const withoutAlice = { ...snapshot, players: [bob] };
    const res = await push(id, 1, ['c1'], withoutAlice);
    expect(res.status).toBe(403);
    const body = res.body as ApiErrorBody;
    expect(body.error).toBe('locked');
    expect(body.reasons).toContain('delete_player');
  });

  it('accepts the same change with the right password', async () => {
    const { id, snapshot, bob } = await seedProtected();
    const withoutAlice = { ...snapshot, players: [bob] };
    const res = await push(id, 1, ['c1'], withoutAlice, 'geheim1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revision: 2 });
  });

  it('rejects the wrong password', async () => {
    const { id, snapshot, bob } = await seedProtected();
    const withoutAlice = { ...snapshot, players: [bob] };
    const res = await push(id, 1, ['c1'], withoutAlice, 'wrong-password');
    expect(res.status).toBe(403);
  });

  it('allows a free change (a new casual result) without the password on a protected tournament', async () => {
    const { id, snapshot, alice, bob } = await seedProtected();
    const match = playedMatch([alice.id], [bob.id], 21, 15, { tournamentId: id });
    const withResult = { ...snapshot, matches: [match] };
    const res = await push(id, 1, ['c1'], withResult);
    expect(res.status).toBe(200);
  });
});

describe('unlock', () => {
  beforeEach(() => start());

  async function seedProtected(): Promise<string> {
    const id = randomUUID();
    await createTournament(snapshotFor(id), 'geheim1');
    return id;
  }

  it('accepts the right password', async () => {
    const id = await seedProtected();
    const res = await api(`/api/tournaments/${id}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'geheim1' }),
    });
    expect(res.status).toBe(204);
  });

  it('rejects the wrong password', async () => {
    const id = await seedProtected();
    const res = await api(`/api/tournaments/${id}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    expect(res.status).toBe(403);
    expect((res.body as ApiErrorBody).error).toBe('locked');
  });

  it('rate limits repeated wrong passwords', async () => {
    const id = await seedProtected();
    let last: { status: number } | undefined;
    for (let i = 0; i < 11; i += 1) {
      last = await api(`/api/tournaments/${id}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong' }),
      });
    }
    expect(last!.status).toBe(429);
  });
});

/* -------------------------------------------------------------------------- */
/* Password lifecycle                                                          */
/* -------------------------------------------------------------------------- */

describe('password endpoint', () => {
  beforeEach(() => start());

  it('sets a password on an unprotected tournament without needing one', async () => {
    const id = randomUUID();
    await createTournament(snapshotFor(id));
    const res = await api(`/api/tournaments/${id}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current: null, next: 'neues-passwort' }),
    });
    expect(res.status).toBe(204);
    const fetched = await api(`/api/tournaments/${id}`);
    expect((fetched.body as { protected: boolean }).protected).toBe(true);
  });

  it('requires the current password to change it', async () => {
    const id = randomUUID();
    await createTournament(snapshotFor(id), 'altes-passwort');
    const wrong = await api(`/api/tournaments/${id}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current: 'falsch', next: 'neu12345' }),
    });
    expect(wrong.status).toBe(403);

    const right = await api(`/api/tournaments/${id}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current: 'altes-passwort', next: 'neu12345' }),
    });
    expect(right.status).toBe(204);
  });

  it('removes the password with next: null', async () => {
    const id = randomUUID();
    await createTournament(snapshotFor(id), 'altes-passwort');
    const res = await api(`/api/tournaments/${id}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current: 'altes-passwort', next: null }),
    });
    expect(res.status).toBe(204);
    const fetched = await api(`/api/tournaments/${id}`);
    expect((fetched.body as { protected: boolean }).protected).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Delete for everyone                                                         */
/* -------------------------------------------------------------------------- */

describe('delete', () => {
  beforeEach(() => start());

  it('deletes an unprotected tournament without a password', async () => {
    const id = randomUUID();
    await createTournament(snapshotFor(id));
    const res = await api(`/api/tournaments/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect((await api(`/api/tournaments/${id}`)).status).toBe(410);
    expect((await push(id, 1, [], snapshotFor(id))).status).toBe(410);
  });

  it('refuses to delete a protected tournament without the password', async () => {
    const id = randomUUID();
    await createTournament(snapshotFor(id), 'geheim1');
    const res = await api(`/api/tournaments/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect((res.body as ApiErrorBody).reasons).toEqual(['delete_tournament']);
  });

  it('deletes a protected tournament with the right password', async () => {
    const id = randomUUID();
    await createTournament(snapshotFor(id), 'geheim1');
    const res = await api(`/api/tournaments/${id}`, {
      method: 'DELETE',
      headers: { [PASSWORD_HEADER]: 'geheim1' },
    });
    expect(res.status).toBe(204);
    expect((await api(`/api/tournaments/${id}`)).status).toBe(410);
  });
});

/* -------------------------------------------------------------------------- */
/* Server-sent events                                                          */
/* -------------------------------------------------------------------------- */

class SseReader {
  private buffer = '';
  private queue: string[] = [];
  private waiters: ((event: string) => void)[] = [];
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
    void this.pump();
  }

  private async pump(): Promise<void> {
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await this.reader.read();
      if (done) return;
      this.buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = this.buffer.indexOf('\n\n')) !== -1) {
        const raw = this.buffer.slice(0, sep);
        this.buffer = this.buffer.slice(sep + 2);
        if (raw.startsWith(':')) continue; // ping comment
        const waiter = this.waiters.shift();
        if (waiter) waiter(raw);
        else this.queue.push(raw);
      }
    }
  }

  async next(): Promise<string> {
    const queued = this.queue.shift();
    if (queued !== undefined) return queued;
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    void this.reader.cancel();
  }
}

describe('server-sent events', () => {
  beforeEach(() => start());

  it('sends the initial state, a state after a push, and deleted on delete', async () => {
    const id = randomUUID();
    await createTournament(snapshotFor(id));

    const res = await fetch(`${baseUrl}/api/tournaments/${id}/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = new SseReader(res.body!);

    const initial = await reader.next();
    expect(initial).toContain('event: state');
    expect(initial).toContain('"revision":1');

    await push(id, 1, ['c1'], snapshotFor(id, { tournament: makeTournament({ id, name: 'X', visibility: 'public' }) }));
    const afterPush = await reader.next();
    expect(afterPush).toContain('event: state');
    expect(afterPush).toContain('"revision":2');

    await api(`/api/tournaments/${id}`, { method: 'DELETE' });
    const afterDelete = await reader.next();
    expect(afterDelete).toContain('event: deleted');

    reader.close();
  });
});

/* -------------------------------------------------------------------------- */
/* Static file serving                                                         */
/* -------------------------------------------------------------------------- */

describe('static file serving', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rally-static-'));
    mkdirSync(join(dir, 'assets'));
    // Padded past the 1024-byte gzip threshold; real bundles are far bigger.
    writeFileSync(
      join(dir, 'index.html'),
      `<html><body><div id="root">${'padding '.repeat(200)}</div></body></html>`,
    );
    writeFileSync(join(dir, 'sw.js'), 'self.addEventListener("install", () => {});');
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1);');
    writeFileSync(join(dir, 'manifest.webmanifest'), '{"name":"Rally"}');
    start({ staticDir: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the index for a known route', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('root');
  });

  it('falls back to index.html for an unknown app route', async () => {
    const res = await fetch(`${baseUrl}/t/${randomUUID()}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('root');
    expect(res.headers.get('cache-control')).toBe('no-cache, must-revalidate');
  });

  it('404s for a missing file under /assets/', async () => {
    const res = await fetch(`${baseUrl}/assets/does-not-exist.js`);
    expect(res.status).toBe(404);
  });

  it('sets long-lived immutable cache headers for assets', async () => {
    const res = await fetch(`${baseUrl}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('sets no-cache and Service-Worker-Allowed for sw.js', async () => {
    const res = await fetch(`${baseUrl}/sw.js`);
    expect(res.headers.get('cache-control')).toBe('no-cache, must-revalidate');
    expect(res.headers.get('service-worker-allowed')).toBe('/');
  });

  it('serves the manifest with the right content type', async () => {
    const res = await fetch(`${baseUrl}/manifest.webmanifest`);
    expect(res.headers.get('content-type')).toContain('application/manifest+json');
  });

  it('gzips a compressible response when the client accepts it', async () => {
    // fetch/undici decompresses transparently when Content-Encoding is set,
    // so the header is the observable part; the body round-trips normally.
    const res = await fetch(`${baseUrl}/`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(await res.text()).toContain('root');
  });

  it('does not gzip when the client sends no Accept-Encoding', async () => {
    const res = await fetch(`${baseUrl}/`, { headers: { 'Accept-Encoding': 'identity' } });
    expect(res.headers.get('content-encoding')).toBeNull();
  });

  it('sends security headers on static responses', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('does not escape the static root via path traversal', async () => {
    const res = await fetch(`${baseUrl}/assets/..%2f..%2fpackage.json`);
    expect(res.status).not.toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* CORS                                                                        */
/* -------------------------------------------------------------------------- */

describe('CORS', () => {
  it('answers a preflight and tags responses when configured', async () => {
    start({ corsOrigin: 'https://example.com' });
    const preflight = await fetch(`${baseUrl}/api/health`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://example.com');
    expect(preflight.headers.get('access-control-allow-methods')).toContain('PUT');

    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.com');
  });

  it('adds no CORS headers when not configured', async () => {
    start();
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
