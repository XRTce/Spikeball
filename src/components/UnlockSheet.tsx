import { useEffect, useState } from 'react';
import { Button, Sheet, TextField } from '../ui';
import { strings } from '../i18n';
import { SyncError, unlockTournament, type ProtectedReason } from '../sync';
import css from '../styles/forms.module.css';

const s = strings;

export function UnlockSheet({
  open,
  tournamentId,
  reasons,
  onClose,
  onUnlocked,
}: {
  open: boolean;
  tournamentId: string;
  /** What the change that triggered this needs the password for, if known. */
  reasons?: ProtectedReason[];
  onClose: () => void;
  onUnlocked: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fresh form every time the sheet is (re)opened.
  useEffect(() => {
    if (open) {
      setPassword('');
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await unlockTournament(tournamentId, password);
      setBusy(false);
      if (ok) {
        onUnlocked();
      } else {
        setError(s.sync.unlock.wrong);
      }
    } catch (err) {
      setBusy(false);
      if (err instanceof SyncError) {
        if (err.code === 'rejected') setError(s.sync.unlock.rejected);
        else if (err.code === 'offline' || err.code === 'unavailable') setError(s.sync.unlock.offline);
        else setError(s.sync.errors.unknown);
      } else {
        setError(s.sync.errors.unknown);
      }
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={s.sync.unlock.title}
      subtitle={
        reasons && reasons.length > 0
          ? s.sync.lockedFor(reasons.map((r) => s.sync.reasons[r]).join(', '))
          : undefined
      }
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {s.common.cancel}
          </Button>
          <Button
            variant="primary"
            icon="unlock"
            busy={busy}
            disabled={!password}
            onClick={() => void submit()}
          >
            {s.sync.unlock.submit}
          </Button>
        </>
      }
    >
      <form
        className={css.form}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextField
          label={s.sync.unlock.passwordLabel}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          autoFocus
          error={error}
          enterKeyHint="done"
        />
      </form>
    </Sheet>
  );
}
