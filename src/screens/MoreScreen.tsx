import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppBar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Screen,
  SectionTitle,
  Sheet,
  Stack,
  TextField,
  useToast,
} from '../ui';
import { ShareSheet } from '../components/ShareSheet';
import { UnlockSheet } from '../components/UnlockSheet';
import { PublishSheet } from '../components/PublishSheet';
import { SyncBadge } from '../components/SyncBadge';
import { CountdownCard } from '../components/CountdownCard';
import { ShareButton } from '../components/ShareButton';
import { strings, formatRelative } from '../i18n';
import { useTournamentView } from './TournamentLayout';
import {
  backToCasual,
  deleteTournament,
  finishTournament,
  renameTournament,
  reopenTournament,
  startFreePlayTimer,
} from '../db/repo';
import { LIMITS } from '../sync/protocol';
import {
  changeTournamentPassword,
  deleteTournamentEverywhere,
  discardPendingChanges,
  isLockedError,
  leaveTournament,
  lockTournament,
  syncNow,
  useServerAvailable,
  useSyncStatus,
} from '../sync';
import { useGuardedAction } from '../state/useGuardedAction';
import { useTimedModeCountdown } from '../state/timedMode';
import { MIN_DRAFT_PLAYERS } from '../domain/pairing/draft';
import form from '../styles/forms.module.css';

const s = strings;

export function MoreScreen() {
  const view = useTournamentView();
  const navigate = useNavigate();
  const toast = useToast();
  const tournament = view.tournament!;
  const guard = useGuardedAction(tournament.id);
  const status = useSyncStatus(tournament.id);
  const serverAvailable = useServerAvailable();
  const isPublic = status.visibility === 'public';
  const syncLocked = status.isProtected && !status.unlocked;

  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(tournament.name);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [shareOpen, setShareOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDeleteEverywhere, setConfirmDeleteEverywhere] = useState(false);
  const [confirmDiscardChanges, setConfirmDiscardChanges] = useState(false);
  const [passwordSheetMode, setPasswordSheetMode] = useState<'set' | 'change' | null>(null);
  const [confirmRemovePassword, setConfirmRemovePassword] = useState(false);

  const isTournament = tournament.phase === 'tournament';
  const timedMode = tournament.timedMode;
  const countdown = useTimedModeCountdown(timedMode);

  return (
    <>
      <AppBar
        title={s.more.title}
        subtitle={tournament.name}
        back={`/t/${tournament.id}`}
        actions={
          <>
            <SyncBadge tournamentId={tournament.id} />
            <ShareButton tournamentId={tournament.id} />
          </>
        }
      />
      <Screen withTabbar>
        <Stack>
          {isPublic && status.error === 'locked' && (
            <Card>
              <CardHeader title={s.sync.more.lockedTitle} />
              <CardBody>
                <Stack>
                  <p className={form.hint}>{s.sync.more.lockedText}</p>
                  <Button variant="primary" icon="unlock" block onClick={() => setUnlockOpen(true)}>
                    {s.sync.more.unlock}
                  </Button>
                  <Button
                    variant="dangerGhost"
                    icon="undo"
                    block
                    onClick={() => setConfirmDiscardChanges(true)}
                  >
                    {s.sync.more.discardChanges}
                  </Button>
                </Stack>
              </CardBody>
            </Card>
          )}

          <SectionTitle>{s.more.tournamentMode}</SectionTitle>
          <Card>
            <CardHeader
              title={
                isTournament
                  ? tournament.format
                    ? s.formats[tournament.format]
                    : s.more.running
                  : s.play.casualTitle
              }
              subtitle={
                isTournament
                  ? `${view.participants.length} ${s.common.players}`
                  : timedMode
                    ? s.more.tournamentModeOff
                    : undefined
              }
              action={
                tournament.status === 'finished' ? (
                  <Badge tone="neutral" icon="trophy">
                    {s.more.statusFinished}
                  </Badge>
                ) : isTournament ? (
                  <Badge tone="brand" icon="bracket">
                    {s.more.statusRunning}
                  </Badge>
                ) : null
              }
            />
            <CardBody>
              {isTournament ? (
                <Stack>
                  {tournament.status === 'finished' ? (
                    <Button
                      variant="secondary"
                      icon="undo"
                      iconAfter={syncLocked ? 'lock' : undefined}
                      block
                      onClick={() => guard.run(() => reopenTournament(tournament.id))}
                    >
                      {s.more.reopen}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      icon="trophy"
                      iconAfter={syncLocked ? 'lock' : undefined}
                      block
                      onClick={() => guard.run(() => finishTournament(tournament.id))}
                    >
                      {s.play.finish}
                    </Button>
                  )}
                  <Button
                    variant="dangerGhost"
                    icon="undo"
                    iconAfter={syncLocked ? 'lock' : undefined}
                    block
                    onClick={() => setConfirmDiscard(true)}
                  >
                    {s.more.backToCasual}
                  </Button>
                </Stack>
              ) : timedMode ? (
                <Stack>
                  <CountdownCard
                    countdown={countdown}
                    notStartedLabel={s.more.timerNotStarted(timedMode.freePlayMinutes)}
                  />
                  {!timedMode.timerStartedAt && (
                    <Button
                      variant="primary"
                      size="lg"
                      icon="play"
                      iconAfter={syncLocked ? 'lock' : undefined}
                      block
                      onClick={() => guard.run(() => startFreePlayTimer(tournament.id))}
                    >
                      {s.more.timerStart}
                    </Button>
                  )}
                  <Button
                    variant={countdown?.expired ? 'primary' : 'secondary'}
                    size="lg"
                    icon="bracket"
                    iconAfter={syncLocked ? 'lock' : undefined}
                    block
                    disabled={view.activePlayers.length < MIN_DRAFT_PLAYERS}
                    onClick={() => navigate(`/t/${tournament.id}/draft`)}
                  >
                    {s.more.draftStart}
                  </Button>
                </Stack>
              ) : (
                <p className={form.hint}>{s.more.leagueModeOff}</p>
              )}
            </CardBody>
          </Card>

          {isPublic && (
            <>
              <SectionTitle>{s.sync.more.section}</SectionTitle>
              <Card>
                <CardBody>
                  <Stack>
                    <Button variant="secondary" icon="qr" block onClick={() => setShareOpen(true)}>
                      {s.sync.more.showQr}
                    </Button>
                    <p className={form.hint}>
                      {status.lastSyncedAt
                        ? s.sync.more.lastSynced(formatRelative(status.lastSyncedAt))
                        : s.sync.more.neverSynced}
                    </p>
                    <Button
                      variant="secondary"
                      icon="refresh"
                      block
                      busy={status.state === 'syncing'}
                      onClick={() => void syncNow(tournament.id)}
                    >
                      {s.sync.more.syncNow}
                    </Button>
                  </Stack>
                </CardBody>
              </Card>

              <SectionTitle>{s.sync.more.passwordSection}</SectionTitle>
              <Card>
                <CardBody>
                  <Stack>
                    {!status.isProtected && (
                      <Button
                        variant="secondary"
                        icon="lock"
                        block
                        onClick={() => setPasswordSheetMode('set')}
                      >
                        {s.sync.more.passwordSet}
                      </Button>
                    )}
                    {status.isProtected && status.unlocked && (
                      <>
                        <Button
                          variant="secondary"
                          icon="lock"
                          block
                          onClick={() => setPasswordSheetMode('change')}
                        >
                          {s.sync.more.passwordChange}
                        </Button>
                        <Button
                          variant="dangerGhost"
                          icon="unlock"
                          block
                          onClick={() => setConfirmRemovePassword(true)}
                        >
                          {s.sync.more.passwordRemove}
                        </Button>
                        <Button
                          variant="secondary"
                          icon="lock"
                          block
                          onClick={() => void lockTournament(tournament.id)}
                        >
                          {s.sync.more.lockDevice}
                        </Button>
                      </>
                    )}
                    {status.isProtected && !status.unlocked && (
                      <Button variant="primary" icon="unlock" block onClick={() => setUnlockOpen(true)}>
                        {s.sync.more.unlock}
                      </Button>
                    )}
                  </Stack>
                </CardBody>
              </Card>
            </>
          )}

          {!isPublic && serverAvailable === true && (
            <>
              <SectionTitle>{s.sync.more.publishSection}</SectionTitle>
              <Card>
                <CardHeader title={s.sync.more.publishAction} subtitle={s.sync.more.publishHint} />
                <CardBody>
                  <Button variant="secondary" icon="qr" block onClick={() => setPublishOpen(true)}>
                    {s.sync.more.publishAction}
                  </Button>
                </CardBody>
              </Card>
            </>
          )}

          <SectionTitle>{s.exportImage.title}</SectionTitle>
          <Card>
            <CardHeader title={s.more.export} subtitle={s.more.exportHint} />
            <CardBody>
              <Button
                variant="secondary"
                icon="image"
                block
                onClick={() => navigate(`/t/${tournament.id}/export`)}
              >
                {s.more.export}
              </Button>
            </CardBody>
          </Card>

          <SectionTitle>{s.more.tournamentSection}</SectionTitle>
          <Card>
            <CardBody>
              <Stack>
                <Button variant="secondary" icon="pencil" block onClick={() => setRenameOpen(true)}>
                  {s.more.rename}
                </Button>
                <Button variant="secondary" icon="settings" block onClick={() => navigate('/settings')}>
                  {s.settings.title}
                </Button>
                {isPublic ? (
                  <>
                    <Button
                      variant="dangerGhost"
                      icon="trash"
                      block
                      onClick={() => setConfirmLeave(true)}
                    >
                      {s.sync.more.leaveAction}
                    </Button>
                    <Button
                      variant="dangerGhost"
                      icon="trash"
                      iconAfter="lock"
                      block
                      onClick={() => setConfirmDeleteEverywhere(true)}
                    >
                      {s.sync.more.deleteEverywhereAction}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="dangerGhost"
                    icon="trash"
                    block
                    onClick={() => setConfirmDelete(true)}
                  >
                    {s.more.delete}
                  </Button>
                )}
              </Stack>
            </CardBody>
          </Card>

          {tournament.clonedFrom && (
            <p className={form.hint}>
              {s.more.clonedFrom(tournament.clonedFrom.name)}
            </p>
          )}
        </Stack>
      </Screen>

      <Sheet
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title={s.more.rename}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRenameOpen(false)}>
              {s.common.cancel}
            </Button>
            <Button
              variant="primary"
              icon="check"
              onClick={() => {
                guard.run(() => renameTournament(tournament.id, name));
                setRenameOpen(false);
              }}
            >
              {s.common.save}
            </Button>
          </>
        }
      >
        <TextField
          label={s.create.name}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          maxLength={60}
        />
      </Sheet>

      <ConfirmDialog
        open={confirmDiscard}
        title={s.more.backToCasualTitle}
        message={timedMode ? s.more.backToCasualTimedText : s.more.backToCasualText}
        confirmLabel={s.more.backToCasual}
        destructive
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          guard.run(() => backToCasual(tournament.id));
          setConfirmDiscard(false);
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={s.more.deleteTitle}
        message={s.more.deleteText}
        confirmLabel={s.common.delete}
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          await deleteTournament(tournament.id);
          navigate('/', { replace: true });
        }}
      />

      <ConfirmDialog
        open={confirmLeave}
        title={s.sync.more.leaveTitle}
        message={s.sync.more.leaveText}
        confirmLabel={s.sync.more.leaveAction}
        destructive
        onCancel={() => setConfirmLeave(false)}
        onConfirm={async () => {
          setConfirmLeave(false);
          await leaveTournament(tournament.id);
          navigate('/', { replace: true });
        }}
      />

      <ConfirmDialog
        open={confirmDeleteEverywhere}
        title={s.sync.more.deleteEverywhereTitle}
        message={s.sync.more.deleteEverywhereText}
        confirmLabel={s.sync.more.deleteEverywhereAction}
        destructive
        onCancel={() => setConfirmDeleteEverywhere(false)}
        onConfirm={() => {
          setConfirmDeleteEverywhere(false);
          guard.run(async () => {
            await deleteTournamentEverywhere(tournament.id);
            navigate('/', { replace: true });
          });
        }}
      />

      <ConfirmDialog
        open={confirmDiscardChanges}
        title={s.sync.more.discardConfirmTitle}
        message={s.sync.more.discardConfirmText}
        confirmLabel={s.sync.more.discardChanges}
        destructive
        onCancel={() => setConfirmDiscardChanges(false)}
        onConfirm={() => {
          setConfirmDiscardChanges(false);
          void discardPendingChanges(tournament.id);
        }}
      />

      <ShareSheet tournamentId={tournament.id} open={shareOpen} onClose={() => setShareOpen(false)} />
      <UnlockSheet
        open={unlockOpen}
        tournamentId={tournament.id}
        onClose={() => setUnlockOpen(false)}
        onUnlocked={() => setUnlockOpen(false)}
      />
      <PublishSheet
        open={publishOpen}
        tournamentId={tournament.id}
        onClose={() => setPublishOpen(false)}
        onPublished={() => {
          setPublishOpen(false);
          setShareOpen(true);
        }}
      />
      <PasswordSheet
        mode={passwordSheetMode}
        tournamentId={tournament.id}
        onClose={() => setPasswordSheetMode(null)}
      />
      <ConfirmDialog
        open={confirmRemovePassword}
        title={s.sync.passwordSet.removeTitle}
        message={s.sync.passwordSet.removeText}
        confirmLabel={s.sync.more.passwordRemove}
        destructive
        onCancel={() => setConfirmRemovePassword(false)}
        onConfirm={() => {
          setConfirmRemovePassword(false);
          guard.run(async () => {
            try {
              await changeTournamentPassword(tournament.id, null);
            } catch (error) {
              if (isLockedError(error)) throw error;
              toast.error(s.errors.generic);
            }
          });
        }}
      />
      {guard.sheet}
    </>
  );
}

function PasswordSheet({
  mode,
  tournamentId,
  onClose,
}: {
  mode: 'set' | 'change' | null;
  tournamentId: string;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!mode) return null;

  const lengthError =
    password.length > 0 && password.length < LIMITS.passwordMin
      ? s.create.passwordTooShort(LIMITS.passwordMin)
      : undefined;
  const mismatch = confirm.length > 0 && confirm !== password ? s.sync.passwordSet.mismatch : undefined;

  const submit = async () => {
    if (lengthError || mismatch || !password) return;
    setBusy(true);
    setError(null);
    try {
      await changeTournamentPassword(tournamentId, password);
      setPassword('');
      setConfirm('');
      onClose();
    } catch {
      setError(s.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={() => {
        setPassword('');
        setConfirm('');
        onClose();
      }}
      title={mode === 'set' ? s.sync.passwordSet.titleSet : s.sync.passwordSet.titleChange}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {s.common.cancel}
          </Button>
          <Button
            variant="primary"
            icon="check"
            busy={busy}
            disabled={!password || !!lengthError || !!mismatch}
            onClick={() => void submit()}
          >
            {s.common.save}
          </Button>
        </>
      }
    >
      <div className={form.form}>
        <TextField
          label={s.sync.passwordSet.newLabel}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          autoComplete="new-password"
          autoFocus
          error={lengthError ?? error ?? undefined}
        />
        <TextField
          label={s.sync.passwordSet.confirmLabel}
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.currentTarget.value)}
          autoComplete="new-password"
          error={mismatch}
        />
      </div>
    </Sheet>
  );
}
