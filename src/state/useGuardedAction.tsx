import { useCallback, useState, type ReactNode } from 'react';
import { UnlockSheet } from '../components/UnlockSheet';
import { strings } from '../i18n';
import { isLockedError, type ProtectedReason } from '../sync';
import { useToast } from '../ui';

interface PendingAction {
  fn: () => unknown;
  reasons: ProtectedReason[];
}

/**
 * Wraps repo mutations so a `locked` SyncError opens the unlock sheet instead
 * of failing silently, and retries the same call once the device unlocks.
 * Harmless for local tournaments and unprotected actions - the mutation just
 * never throws `locked` there.
 */
export function useGuardedAction(tournamentId: string): {
  run: (fn: () => unknown) => void;
  sheet: ReactNode;
} {
  const toast = useToast();
  const [pending, setPending] = useState<PendingAction | null>(null);

  const run = useCallback(
    (fn: () => unknown) => {
      void (async () => {
        try {
          await fn();
        } catch (error) {
          if (isLockedError(error)) {
            setPending({ fn, reasons: error.reasons });
          } else {
            console.error(error);
            toast.error(strings.errors.generic);
          }
        }
      })();
    },
    [toast],
  );

  const sheet = (
    <UnlockSheet
      open={pending !== null}
      tournamentId={tournamentId}
      reasons={pending?.reasons}
      onClose={() => setPending(null)}
      onUnlocked={() => {
        const action = pending;
        setPending(null);
        if (action) run(action.fn);
      }}
    />
  );

  return { run, sheet };
}
