/**
 * Ephemeral, in-memory sync state that is not worth persisting to Dexie:
 * whether a push/pull is in flight right now, and notices for things that
 * happen outside any user action (docs/SYNC.md's sync loop). Exposed through
 * a tiny external-store shape so hooks.ts can drive React re-renders with
 * useSyncExternalStore.
 */
import type { ProtectedReason } from './protocol';

/** Things the UI should tell the user about that happen outside any action. */
export type SyncNotice =
  /** Queued changes could not be applied on top of someone else's newer ones and were dropped. */
  | { kind: 'dropped'; tournamentId: string; count: number }
  /** The server refused queued changes without the password; see discardPendingChanges(). */
  | { kind: 'locked'; tournamentId: string; reasons: ProtectedReason[] }
  /** Someone deleted the tournament for everyone. The local copy is kept, now as a local tournament. */
  | { kind: 'deleted'; tournamentId: string };

const syncing = new Set<string>();
const syncingListeners = new Map<string, Set<() => void>>();

export function isSyncing(tournamentId: string): boolean {
  return syncing.has(tournamentId);
}

export function setSyncing(tournamentId: string, value: boolean): void {
  const was = syncing.has(tournamentId);
  if (value === was) return;
  if (value) syncing.add(tournamentId);
  else syncing.delete(tournamentId);
  syncingListeners.get(tournamentId)?.forEach((listener) => listener());
}

export function subscribeSyncing(tournamentId: string, listener: () => void): () => void {
  let set = syncingListeners.get(tournamentId);
  if (!set) {
    set = new Set();
    syncingListeners.set(tournamentId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) syncingListeners.delete(tournamentId);
  };
}

const noticeListeners = new Set<(notice: SyncNotice) => void>();

export function emitNotice(notice: SyncNotice): void {
  noticeListeners.forEach((listener) => listener(notice));
}

export function onSyncNotice(listener: (notice: SyncNotice) => void): () => void {
  noticeListeners.add(listener);
  return () => {
    noticeListeners.delete(listener);
  };
}

/** Test-only: drops all in-memory state so tests do not leak into each other. */
export function resetSyncStore(): void {
  syncing.clear();
  syncingListeners.clear();
  noticeListeners.clear();
}
