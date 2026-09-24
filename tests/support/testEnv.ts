/**
 * Wires the sync engine to a fresh FakeServer and resets every module-level
 * bit of state the engine and store keep, so tests do not leak into each
 * other. Call setupSyncTest() from beforeEach.
 */
import { configureSync } from '../../src/sync/config';
import { resetSyncEngine } from '../../src/sync/engine';
import { resetSyncStore } from '../../src/sync/store';
import { createFakeServer, FAKE_API_BASE, type FakeServer } from './fakeServer';

export interface SyncTestEnv {
  server: FakeServer;
  /** Mutable online flag; flip it and the engine's next attempt sees it. */
  online: { value: boolean };
}

export function setupSyncTest(): SyncTestEnv {
  resetSyncEngine();
  resetSyncStore();

  const server = createFakeServer();
  const online = { value: true };

  configureSync({
    fetch: server.fetch,
    apiBase: () => FAKE_API_BASE,
    isOnline: () => online.value,
    // Real timers would make backoff tests slow and flaky; tests drive
    // retries explicitly via syncNow() instead of waiting on a timer.
    setTimeout: () => undefined,
    clearTimeout: () => {},
    EventSource: undefined,
    addWindowListener: () => () => {},
    addDocumentListener: () => () => {},
  });

  return { server, online };
}
