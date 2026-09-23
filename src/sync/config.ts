/**
 * Everything the sync engine needs from the outside world, gathered behind
 * one small, overridable surface. Tests run in vitest's `node` environment,
 * where `window`, `location`, `navigator` and `EventSource` do not exist, so
 * nothing here may be evaluated at module load time - only when a call
 * actually needs it, by which point a test has called `configureSync`.
 */

export type FetchLike = typeof fetch;
export type EventSourceLike = typeof EventSource;

export interface SyncEnv {
  fetch: FetchLike;
  /** undefined = no EventSource available (Node, or a very old browser); useLiveSync then no-ops. */
  EventSource: EventSourceLike | undefined;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  isOnline: () => boolean;
  /** Base URL for the API, no trailing slash, e.g. "https://host/api". */
  apiBase: () => string;
  /** Returns an unsubscribe function; no-ops outside a browser. */
  addWindowListener: (type: string, handler: () => void) => () => void;
  addDocumentListener: (type: string, handler: () => void) => () => void;
}

function computeDefaultApiBase(): string {
  const configured = (import.meta.env.VITE_SYNC_URL as string | undefined)?.trim();
  if (configured) return `${configured.replace(/\/+$/, '')}/api`;
  if (typeof location === 'undefined') {
    throw new Error('No sync API base configured; pass apiBase via configureSync() outside a browser');
  }
  const base = new URL('api/', location.origin + import.meta.env.BASE_URL).toString();
  return base.replace(/\/+$/, '');
}

function defaultFetch(...args: Parameters<FetchLike>): ReturnType<FetchLike> {
  return globalThis.fetch(...args);
}

function defaultEventSource(): EventSourceLike | undefined {
  return typeof EventSource === 'undefined' ? undefined : EventSource;
}

function browserListener(target: 'window' | 'document') {
  return (type: string, handler: () => void): (() => void) => {
    const host = target === 'window' ? globalThis.window : globalThis.document;
    if (!host) return () => {};
    host.addEventListener(type, handler);
    return () => host.removeEventListener(type, handler);
  };
}

function makeDefaultEnv(): SyncEnv {
  return {
    fetch: defaultFetch,
    EventSource: defaultEventSource(),
    now: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    apiBase: computeDefaultApiBase,
    addWindowListener: browserListener('window'),
    addDocumentListener: browserListener('document'),
  };
}

let env: SyncEnv = makeDefaultEnv();

/** Overrides any subset of the sync environment; tests use this to run without a browser. */
export function configureSync(overrides: Partial<SyncEnv>): void {
  env = { ...env, ...overrides };
}

/** Restores the browser defaults, dropping every override from configureSync(). */
export function resetSyncEnv(): void {
  env = makeDefaultEnv();
}

export function getSyncEnv(): SyncEnv {
  return env;
}
