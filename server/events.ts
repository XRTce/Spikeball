/**
 * Server-sent events hub: one stream per connected client, grouped by
 * tournament id so a push or password change can be broadcast to everyone
 * currently watching that tournament.
 */
import type { ServerResponse } from 'node:http';
import type { StateEvent } from '../src/sync/protocol';

/** Refused beyond this many simultaneous viewers of one tournament. */
const MAX_CONNECTIONS_PER_TOURNAMENT = 200;

const PING_INTERVAL_MS = 25_000;

export class EventHub {
  private readonly streams = new Map<string, Set<ServerResponse>>();

  connectionCount(tournamentId: string): number {
    return this.streams.get(tournamentId)?.size ?? 0;
  }

  atCapacity(tournamentId: string): boolean {
    return this.connectionCount(tournamentId) >= MAX_CONNECTIONS_PER_TOURNAMENT;
  }

  /** Registers `res` as an SSE client for a tournament and starts the ping timer. Returns a cleanup function. */
  subscribe(tournamentId: string, res: ServerResponse): () => void {
    let set = this.streams.get(tournamentId);
    if (!set) {
      set = new Set();
      this.streams.set(tournamentId, set);
    }
    set.add(res);

    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* the close handler below cleans this connection up */
      }
    }, PING_INTERVAL_MS);
    ping.unref();

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      const current = this.streams.get(tournamentId);
      current?.delete(res);
      if (current && current.size === 0) this.streams.delete(tournamentId);
    };
    res.on('close', cleanup);
    return cleanup;
  }

  sendState(res: ServerResponse, state: StateEvent): void {
    res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
  }

  broadcastState(tournamentId: string, state: StateEvent): void {
    const set = this.streams.get(tournamentId);
    if (!set) return;
    const payload = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
    for (const res of set) {
      try {
        res.write(payload);
      } catch {
        /* dropped connection; its own close handler will clean it up */
      }
    }
  }

  /** Tells every listener the tournament is gone and closes their streams. */
  broadcastDeleted(tournamentId: string): void {
    const set = this.streams.get(tournamentId);
    if (!set) return;
    for (const res of [...set]) {
      try {
        res.write('event: deleted\ndata: {}\n\n');
        res.end();
      } catch {
        /* already gone */
      }
    }
    this.streams.delete(tournamentId);
  }
}
