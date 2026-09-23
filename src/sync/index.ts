/**
 * Public API of the sync layer. Screens and components import from here and
 * nowhere else in src/sync.
 *
 * CONTRACT STUB: the signatures and doc comments below are the agreed
 * interface. The bodies are placeholders that behave as if no sync server
 * existed, so the UI compiles and renders while the engine is built. The
 * engine replaces the bodies (it may move them into other files and re-export
 * them) without changing a signature.
 */
import type { TournamentVisibility } from '../domain/types';
import type { ProtectedReason, SyncErrorCode } from './protocol';

export type { ProtectedReason, SyncErrorCode } from './protocol';

/* ------------------------------------------------------------------------ */
/* Errors and notices                                                         */
/* ------------------------------------------------------------------------ */

/**
 * Thrown by sync actions, and by repo mutations on a public tournament.
 *
 * Code `locked` from a repo mutation means that the change needs the admin
 * password and this device does not hold it. Nothing was written. The UI
 * shows the unlock sheet and, after a successful unlock, calls the same
 * mutation again. `wrong_password` only comes from unlock and password
 * changes.
 */
export class SyncError extends Error {
  readonly code: SyncErrorCode | 'wrong_password';
  readonly reasons: ProtectedReason[];

  constructor(code: SyncErrorCode | 'wrong_password', reasons: ProtectedReason[] = [], message?: string) {
    super(message ?? code);
    this.name = 'SyncError';
    this.code = code;
    this.reasons = reasons;
  }
}

export function isLockedError(error: unknown): error is SyncError {
  return error instanceof SyncError && error.code === 'locked';
}

/** Things the UI should tell the user about that happen outside any action. */
export type SyncNotice =
  /** Queued changes could not be applied on top of someone else's newer ones and were dropped. */
  | { kind: 'dropped'; tournamentId: string; count: number }
  /** The server refused queued changes without the password; see discardPendingChanges(). */
  | { kind: 'locked'; tournamentId: string; reasons: ProtectedReason[] }
  /** Someone deleted the tournament for everyone. The local copy is kept, now as a local tournament. */
  | { kind: 'deleted'; tournamentId: string };

/** Subscribes to notices; returns the unsubscribe function. */
export function onSyncNotice(listener: (notice: SyncNotice) => void): () => void {
  void listener;
  return () => {};
}

/* ------------------------------------------------------------------------ */
/* Status                                                                     */
/* ------------------------------------------------------------------------ */

export type SyncState =
  /** Not a public tournament. */
  | 'local'
  /** Local copy equals the server's latest revision. */
  | 'synced'
  /** A push or pull is in flight. */
  | 'syncing'
  /** Changes are queued and will be pushed when possible. */
  | 'pending'
  /** The last attempt failed; see `error`. Queued changes are kept. */
  | 'error';

export interface SyncStatus {
  visibility: TournamentVisibility;
  /** 'owner' = created or published on this device, 'joined' = opened via link. null for local. */
  role: 'owner' | 'joined' | null;
  state: SyncState;
  /** Queued local changes not yet on the server. */
  pendingCount: number;
  lastSyncedAt: number | null;
  error: SyncErrorCode | null;
  /** The server has an admin password for this tournament. */
  isProtected: boolean;
  /** Protected actions are possible on this device: no password is set, or it is remembered here. */
  unlocked: boolean;
  /** False until the first upload succeeded (created while offline). */
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

/** Live sync status of one tournament. Re-renders on every change. */
export function useSyncStatus(tournamentId: string | undefined): SyncStatus {
  void tournamentId;
  return LOCAL_STATUS;
}

/**
 * Whether a sync server answers at the configured URL. null while the first
 * check runs. The "public" option is only offered when this is true.
 */
export function useServerAvailable(): boolean | null {
  return false;
}

/**
 * Keeps one tournament live while mounted. It subscribes to the server's
 * event stream and pulls every new revision into IndexedDB, and the screens
 * re-render through their live queries. It does nothing for local
 * tournaments.
 */
export function useLiveSync(tournamentId: string | undefined): void {
  void tournamentId;
}

/**
 * Starts background sync once at app start. It flushes queued changes on
 * `online`, on returning to the tab, and on a timer while anything is
 * pending.
 */
export function startSyncEngine(): void {}

/** Pushes queued changes and pulls the latest revision now. Never throws; see useSyncStatus. */
export async function syncNow(tournamentId: string): Promise<void> {
  void tournamentId;
}

/* ------------------------------------------------------------------------ */
/* Sharing                                                                    */
/* ------------------------------------------------------------------------ */

/** Absolute link that opens the tournament in the app, for the QR code and the share sheet. */
export function shareUrl(tournamentId: string): string {
  return new URL(`t/${tournamentId}`, `${location.origin}${import.meta.env.BASE_URL}`).toString();
}

/**
 * Extracts a tournament id from whatever the user pasted: a full share link
 * (from any host), a path, or the bare id. null if nothing looks like one.
 */
export function parseJoinInput(input: string): string | null {
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(input);
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * Makes a local tournament public: marks it, remembers the password on this
 * device (role 'owner'), and uploads it. It also works offline: the upload is
 * then queued and the status shows `uploaded: false` until it goes through.
 * The password is optional; null means anyone with the link may do anything.
 */
export async function publishTournament(tournamentId: string, password: string | null): Promise<void> {
  void tournamentId;
  void password;
  throw new SyncError('unavailable');
}

/**
 * Fetches a public tournament by id and stores it on this device (role
 * 'joined'). If it is already here, it syncs instead. Throws SyncError with
 * `not_found`, `deleted`, `offline` or `unavailable`.
 */
export async function joinTournament(tournamentId: string): Promise<void> {
  void tournamentId;
  throw new SyncError('unavailable');
}

/* ------------------------------------------------------------------------ */
/* Admin password                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Checks the password with the server and remembers it on this device.
 * Returns false for a wrong password. Throws SyncError `offline` or
 * `unavailable`; too many wrong attempts (HTTP 429) throw `rejected`.
 */
export async function unlockTournament(tournamentId: string, password: string): Promise<boolean> {
  void tournamentId;
  void password;
  throw new SyncError('unavailable');
}

/** Forgets the remembered password on this device. */
export async function lockTournament(tournamentId: string): Promise<void> {
  void tournamentId;
}

/**
 * Sets, changes (`next` = string) or removes (`next` = null) the password.
 * The remembered password is sent as the current one, so the device must be
 * unlocked when a password is set. Online only. Throws SyncError `locked` or
 * `wrong_password`.
 */
export async function changeTournamentPassword(tournamentId: string, next: string | null): Promise<void> {
  void tournamentId;
  void next;
  throw new SyncError('unavailable');
}

/* ------------------------------------------------------------------------ */
/* Leaving and deleting                                                       */
/* ------------------------------------------------------------------------ */

/** Removes a public tournament from this device only. Everyone else keeps it. Always allowed. */
export async function leaveTournament(tournamentId: string): Promise<void> {
  void tournamentId;
}

/**
 * Deletes the tournament on the server for everyone, then on this device.
 * Online only. Needs the password if one is set: throws SyncError `locked`.
 */
export async function deleteTournamentEverywhere(tournamentId: string): Promise<void> {
  void tournamentId;
  throw new SyncError('unavailable');
}

/**
 * Throws away queued changes and resets the local copy to the server's
 * latest revision. This is the way out after a `locked` notice when nobody
 * knows the password.
 */
export async function discardPendingChanges(tournamentId: string): Promise<void> {
  void tournamentId;
}
