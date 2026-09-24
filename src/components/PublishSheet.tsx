import { useState } from 'react';
import { Button, Sheet, TextField, useToast } from '../ui';
import { strings } from '../i18n';
import { publishTournament } from '../sync';
import { LIMITS } from '../sync/protocol';
import form from '../styles/forms.module.css';

const s = strings;

/**
 * Publishes a private tournament to the sync server, optionally protecting it
 * with an admin password. Shared by MoreScreen's "Öffentlich teilen" section
 * and the header ShareButton - both chain into ShareSheet via `onPublished`.
 */
export function PublishSheet({
  open,
  tournamentId,
  onClose,
  onPublished,
}: {
  open: boolean;
  tournamentId: string;
  onClose: () => void;
  onPublished: () => void;
}) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordError =
    password.length > 0 && password.length < LIMITS.passwordMin
      ? s.create.passwordTooShort(LIMITS.passwordMin)
      : undefined;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={s.sync.more.publishAction}
      subtitle={s.sync.more.publishHint}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {s.common.cancel}
          </Button>
          <Button
            variant="primary"
            icon="qr"
            busy={busy}
            disabled={!!passwordError}
            onClick={async () => {
              setBusy(true);
              try {
                await publishTournament(tournamentId, password || null);
                setPassword('');
                onPublished();
              } catch (error) {
                console.error(error);
                toast.error(s.errors.generic);
              } finally {
                setBusy(false);
              }
            }}
          >
            {s.sync.more.publishAction}
          </Button>
        </>
      }
    >
      <TextField
        label={s.create.password}
        type="password"
        value={password}
        onChange={(event) => setPassword(event.currentTarget.value)}
        autoComplete="new-password"
        error={passwordError}
      />
      <p className={form.hint}>{s.create.passwordHint}</p>
    </Sheet>
  );
}
