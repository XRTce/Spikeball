/**
 * SyncError lives in its own module (rather than in index.ts, where it is
 * documented and re-exported) so that commands.ts and engine.ts can import
 * and throw it without creating a module cycle through index.ts.
 */
import type { ProtectedReason, SyncErrorCode } from './protocol';

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
