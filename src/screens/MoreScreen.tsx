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
} from '../ui';
import { strings } from '../i18n';
import { useTournamentView } from './TournamentLayout';
import {
  backToCasual,
  deleteTournament,
  finishTournament,
  renameTournament,
  reopenTournament,
  startFreePlayTimer,
} from '../db/repo';
import { useTimedModeCountdown } from '../state/timedMode';
import form from '../styles/forms.module.css';

const s = strings;

export function MoreScreen() {
  const view = useTournamentView();
  const navigate = useNavigate();
  const tournament = view.tournament!;

  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(tournament.name);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isTournament = tournament.phase === 'tournament';
  const timedMode = tournament.timedMode;
  const countdown = useTimedModeCountdown(timedMode);

  return (
    <>
      <AppBar title={s.more.title} subtitle={tournament.name} back={`/t/${tournament.id}`} />
      <Screen withTabbar>
        <Stack>
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
                    Beendet
                  </Badge>
                ) : isTournament ? (
                  <Badge tone="brand" icon="bracket">
                    laeuft
                  </Badge>
                ) : null
              }
            />
            <CardBody>
              {isTournament ? (
                <Stack>
                  {tournament.status === 'finished' ? (
                    <Button variant="secondary" icon="undo" block onClick={() => void reopenTournament(tournament.id)}>
                      Turnier wieder oeffnen
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      icon="trophy"
                      block
                      onClick={() => void finishTournament(tournament.id)}
                    >
                      {s.play.finish}
                    </Button>
                  )}
                  <Button
                    variant="dangerGhost"
                    icon="undo"
                    block
                    onClick={() => setConfirmDiscard(true)}
                  >
                    {s.more.backToCasual}
                  </Button>
                </Stack>
              ) : timedMode ? (
                <Stack>
                  {!timedMode.timerStartedAt ? (
                    <>
                      <p className={form.hint}>{s.more.timerNotStarted(timedMode.freePlayMinutes)}</p>
                      <Button
                        variant="primary"
                        size="lg"
                        icon="play"
                        block
                        onClick={() => void startFreePlayTimer(tournament.id)}
                      >
                        {s.more.timerStart}
                      </Button>
                    </>
                  ) : (
                    <Badge tone={countdown?.expired ? 'warn' : 'neutral'}>
                      {countdown?.expired ? s.more.timerExpired : countdown?.label}
                    </Badge>
                  )}
                  <Button
                    variant={countdown?.expired ? 'primary' : 'secondary'}
                    size="lg"
                    icon="bracket"
                    block
                    disabled={view.activePlayers.length < 4}
                    onClick={() => navigate(`/t/${tournament.id}/draft`)}
                  >
                    {countdown?.expired ? s.more.draftStartExpired : s.more.draftStart}
                  </Button>
                </Stack>
              ) : (
                <p className={form.hint}>{s.more.leagueModeOff}</p>
              )}
            </CardBody>
          </Card>

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

          <SectionTitle>Turnier</SectionTitle>
          <Card>
            <CardBody>
              <Stack>
                <Button variant="secondary" icon="pencil" block onClick={() => setRenameOpen(true)}>
                  {s.more.rename}
                </Button>
                <Button variant="secondary" icon="settings" block onClick={() => navigate('/settings')}>
                  {s.settings.title}
                </Button>
                <Button
                  variant="dangerGhost"
                  icon="trash"
                  block
                  onClick={() => setConfirmDelete(true)}
                >
                  {s.more.delete}
                </Button>
              </Stack>
            </CardBody>
          </Card>

          {tournament.clonedFrom && (
            <p className={form.hint}>
              Spieler uebernommen aus &bdquo;{tournament.clonedFrom.name}&ldquo;.
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
              onClick={async () => {
                await renameTournament(tournament.id, name);
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
        message={s.more.backToCasualText}
        confirmLabel={s.more.backToCasual}
        destructive
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          void backToCasual(tournament.id);
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
    </>
  );
}
