/**
 * React hooks: the only part of the sync layer screens interact with besides
 * the plain async functions in index.ts.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { TournamentVisibility } from '../domain/types';
import type { SyncErrorCode } from './protocol';
import { checkHealth } from './api';
import { attachLiveSync, detachLiveSync } from './engine';
import { isSyncing, subscribeSyncing } from './store';

export type SyncState = 'local' | 'synced' | 'syncing' | 'pending' | 'error';

export interface SyncStatus {
  visibility: TournamentVisibility;
  role: 'owner' | 'joined' | null;
  state: SyncState;
  pendingCount: number;
  lastSyncedAt: number | null;
  error: SyncErrorCode | null;
  isProtected: boolean;
  unlocked: boolean;
  uploaded: boolean;
}

const LOCAL_STATUS: SyncStatus = {
  visibility: 'local',
  role: null,
  state: 'local',
  pendingCount: 0,
  lastSyncedAt: null,
  error: null,
  isProtected: false,
  unlocked: true,
  uploaded: false,
};

function useSyncingFlag(tournamentId: string | undefined): boolean {
  const subscribe = useMemo(
    () => (listener: () => void) => (tournamentId ? subscribeSyncing(tournamentId, listener) : () => {}),
    [tournamentId],
  );
  const getSnapshot = () => (tournamentId ? isSyncing(tournamentId) : false);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Live sync status of one tournament. Re-renders on every change. */
export function useSyncStatus(tournamentId: string | undefined): SyncStatus {
  const row = useLiveQuery(async () => {
    if (!tournamentId) return undefined;
    const [tournament, sync] = await Promise.all([db.tournaments.get(tournamentId), db.sync.get(tournamentId)]);
    return { tournament, sync };
  }, [tournamentId]);

  const syncing = useSyncingFlag(tournamentId);

  return useMemo<SyncStatus>(() => {
    if (!tournamentId || !row?.tournament || row.tournament.visibility !== 'public' || !row.sync) {
      return LOCAL_STATUS;
    }
    const { sync } = row;
    const state: SyncState = syncing
      ? 'syncing'
      : sync.error
        ? 'error'
        : sync.pending.length > 0 || sync.revision === 0
          ? 'pending'
          : 'synced';

    return {
      visibility: 'public',
      role: sync.role,
      state,
      pendingCount: sync.pending.length,
      lastSyncedAt: sync.lastSyncedAt,
      error: sync.error,
      isProtected: sync.protected,
      unlocked: !sync.protected || sync.adminPassword != null,
      uploaded: sync.revision > 0,
    };
  }, [tournamentId, row, syncing]);
}

let healthCache: boolean | null = null;
const healthListeners = new Set<() => void>();

function setHealthCache(value: boolean): void {
  healthCache = value;
  healthListeners.forEach((listener) => listener());
}

async function refreshHealth(): Promise<void> {
  setHealthCache(await checkHealth());
}

/** Whether a sync server answers at the configured URL. null while the first check runs. */
export function useServerAvailable(): boolean | null {
  const subscribe = (listener: () => void) => {
    healthListeners.add(listener);
    return () => healthListeners.delete(listener);
  };
  const getSnapshot = () => healthCache;
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (healthCache === null) void refreshHealth();
    const unsubscribe =
      typeof window === 'undefined'
        ? () => {}
        : (() => {
            const handler = () => void refreshHealth();
            window.addEventListener('online', handler);
            return () => window.removeEventListener('online', handler);
          })();
    return unsubscribe;
  }, []);

  return value;
}

/** Test-only: forgets the cached health check result. */
export function resetServerAvailableCache(): void {
  healthCache = null;
}

/**
 * Keeps one tournament live while mounted via the server's event stream. Does
 * nothing for a local tournament.
 */
export function useLiveSync(tournamentId: string | undefined): void {
  useEffect(() => {
    if (!tournamentId) return undefined;
    let attached = false;
    let cancelled = false;

    void (async () => {
      const tournament = await db.tournaments.get(tournamentId);
      if (cancelled || tournament?.visibility !== 'public') return;
      attached = true;
      attachLiveSync(tournamentId);
    })();

    return () => {
      cancelled = true;
      if (attached) detachLiveSync(tournamentId);
    };
  }, [tournamentId]);
}
