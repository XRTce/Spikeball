/**
 * Wires the sync engine to a fresh FakeServer and resets every module-level
 * bit of state the engine and store keep, so tests do not leak into each
 * other. Call setupSyncTest() from beforeEach.
 */
import { configureSync, type SyncEnv } from '../../src/sync/config';
import { resetSyncEngine } from '../../src/sync/engine';
import { resetSyncStore } from '../../src/sync/store';
import { createFakeServer, FAKE_API_BASE, type FakeServer } from './fakeServer';

/**
 * A fake timer queue standing in for setTimeout/clearTimeout: tests drive
 * retries explicitly via syncNow() rather than waiting on real backoff
 * delays, but still need to see whether the engine actually cancels a
 * scheduled retry (as opposed to merely leaving it to no-op once it fires).
 */
export interface FakeTimers {
  /** Timers currently scheduled and not yet cleared or run. */
  pendingCount(): number;
  /**
   * The callbacks currently scheduled, without removing them. Lets a test
   * hold on to a retry and invoke it after the engine cancelled it, the way a
   * timer that was already due when clearTimeout ran would still fire.
   */
  captured(): Array<() => void>;
  /** Runs every currently-scheduled callback once, as if its delay had elapsed. Callbacks newly scheduled by one of them are left for the next runAll(). */
  runAll(): void;
}

function createFakeTimers(): FakeTimers & Pick<SyncEnv, 'setTimeout' | 'clearTimeout'> {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  return {
    setTimeout: (fn: () => void) => {
      const handle = nextHandle++;
      pending.set(handle, fn);
      return handle;
    },
    clearTimeout: (handle: unknown) => {
      pending.delete(handle as number);
    },
    pendingCount: () => pending.size,
    captured: () => [...pending.values()],
    runAll: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const fn of callbacks) fn();
    },
  };
}

export interface SyncTestEnv {
  server: FakeServer;
  /** Mutable online flag; flip it and the engine's next attempt sees it. */
  online: { value: boolean };
  /** Scheduled backoff/retry timers; see FakeTimers. */
  timers: FakeTimers;
}

export function setupSyncTest(): SyncTestEnv {
  resetSyncEngine();
  resetSyncStore();

  const server = createFakeServer();
  const online = { value: true };
  const timers = createFakeTimers();

  configureSync({
    fetch: server.fetch,
    apiBase: () => FAKE_API_BASE,
    isOnline: () => online.value,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    EventSource: undefined,
    addWindowListener: () => () => {},
    addDocumentListener: () => () => {},
  });

  return { server, online, timers };
}
