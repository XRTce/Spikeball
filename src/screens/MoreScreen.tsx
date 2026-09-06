import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppBar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  NumberStepper,
  Screen,
  SectionTitle,
  Sheet,
  Stack,
  Switch,
  TextField,
  useToast,
} from '../ui';
import { OptionList } from '../components/OptionList';
import { strings, joinNames } from '../i18n';
import { useTournamentView } from './TournamentLayout';
import {
  backToCasual,
  deleteTournament,
  finishTournament,
  renameTournament,
  reopenTournament,
  startTournament,
} from '../db/repo';
import { roundRobinSize } from '../domain/pairing/roundRobin';
import { suggestedSwissRounds } from '../domain/pairing/swiss';
import { eliminationSize } from '../domain/pairing/elimination';
import {
  TOURNAMENT_FORMATS,
  isEliminationFormat,
  type TournamentFormat,
} from '../domain/types';
import form from '../styles/forms.module.css';

const s = strings;

export function MoreScreen() {
  const view = useTournamentView();
  const navigate = useNavigate();
  const toast = useToast();
  const tournament = view.tournament!;

  const [startOpen, setStartOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(tournament.name);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isTournament = tournament.phase === 'tournament';

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
                  : s.more.tournamentModeOff
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
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  icon="bracket"
                  block
                  disabled={view.activePlayers.length < view.teamSize * 2}
                  onClick={() => setStartOpen(true)}
                >
                  {s.more.start}
                </Button>
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

      <StartTournamentSheet
        open={startOpen}
        onClose={() => setStartOpen(false)}
        onStarted={(unassigned) => {
          setStartOpen(false);
          if (unassigned.length > 0) toast.show(s.more.unassigned(joinNames(unassigned)));
          else toast.success('Spielplan erstellt');
          navigate(`/t/${tournament.id}`);
        }}
      />

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

/* ------------------------------------------------------------------------ */

function StartTournamentSheet({
  open,
  onClose,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  onStarted: (unassigned: string[]) => void;
}) {
  const view = useTournamentView();
  const toast = useToast();
  const tournament = view.tournament!;

  const [format, setFormat] = useState<TournamentFormat>('round_robin');
  const [limit, setLimit] = useState(0);
  const [swissRounds, setSwissRounds] = useState(0);
  const [thirdPlace, setThirdPlace] = useState(tournament.play.thirdPlaceMatch);
  const [reset, setReset] = useState(tournament.play.grandFinalReset);
  const [busy, setBusy] = useState(false);

  // The n best active players by current rating enter the tournament.
  const ranked = useMemo(
    () =>
      [...view.activePlayers].sort(
        (a, b) =>
          (view.ratings[b.id] ?? b.baseElo) - (view.ratings[a.id] ?? a.baseElo) ||
          a.name.localeCompare(b.name, 'de'),
      ),
    [view.activePlayers, view.ratings],
  );

  const effectiveLimit = limit === 0 ? ranked.length : Math.min(limit, ranked.length);
  const participants = ranked.slice(0, effectiveLimit);
  const teamCount = isEliminationFormat(format)
    ? Math.floor(participants.length / view.teamSize)
    : 0;

  const preview = useMemo(() => {
    if (format === 'round_robin') return roundRobinSize(participants.length, view.teamSize);
    if (format === 'swiss') {
      const rounds =
        swissRounds || suggestedSwissRounds(participants.length, view.teamSize);
      const perRound = Math.floor(participants.length / (view.teamSize * 2));
      return { rounds, matches: rounds * perRound };
    }
    return eliminationSize(teamCount, format, thirdPlace);
  }, [format, participants.length, swissRounds, teamCount, thirdPlace, view.teamSize]);

  const minPlayers = isEliminationFormat(format) ? view.teamSize * 4 : view.teamSize * 2;
  const tooFew = participants.length < minPlayers;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={s.more.startTitle}
      subtitle={s.more.preview(preview.rounds, preview.matches)}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {s.common.cancel}
          </Button>
          <Button
            variant="primary"
            icon="bracket"
            busy={busy}
            disabled={tooFew}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await startTournament({
                  tournamentId: tournament.id,
                  format,
                  participantIds: participants.map((player) => player.id),
                  ...(format === 'swiss' && swissRounds ? { swissRounds } : {}),
                  thirdPlaceMatch: thirdPlace,
                  grandFinalReset: reset,
                });
                onStarted(
                  result.unassigned.map(
                    (id) => view.playerById.get(id)?.name ?? '?',
                  ),
                );
              } catch (error) {
                toast.error(error instanceof Error ? error.message : s.errors.generic);
              } finally {
                setBusy(false);
              }
            }}
          >
            {s.more.startConfirm}
          </Button>
        </>
      }
    >
      <div className={form.form}>
        <div>
          <div className={form.groupTitle} style={{ marginBottom: 'var(--space-2)' }}>
            {s.more.format}
          </div>
          <OptionList
            ariaLabel={s.more.format}
            value={format}
            onChange={setFormat}
            options={TOURNAMENT_FORMATS.map((value) => ({
              value,
              label: s.formats[value],
              text: s.formatHints[value],
            }))}
          />
        </div>

        <NumberStepper
          label={s.more.participants}
          hint={
            limit === 0
              ? s.more.participantsAll
              : s.more.participantsHint(effectiveLimit)
          }
          value={limit === 0 ? ranked.length : limit}
          onChange={(value) => setLimit(value >= ranked.length ? 0 : value)}
          min={minPlayers}
          max={Math.max(minPlayers, ranked.length)}
        />

        {isEliminationFormat(format) && (
          <p className={form.hint}>
            Aus den {participants.length} Teilnehmern werden {teamCount} feste Teams gebildet -
            jeweils der Staerkste mit dem Schwaechsten, damit die Paare ausgeglichen sind. Die
            Einzel-Elo laeuft trotzdem fuer jedes Spiel weiter.
          </p>
        )}

        {format === 'swiss' && (
          <NumberStepper
            label={s.more.swissRounds}
            value={swissRounds || suggestedSwissRounds(participants.length, view.teamSize)}
            onChange={setSwissRounds}
            min={1}
            max={15}
          />
        )}

        {format === 'single_elim' && (
          <Switch checked={thirdPlace} onChange={setThirdPlace} label={s.more.thirdPlace} />
        )}

        {format === 'double_elim' && (
          <Switch
            checked={reset}
            onChange={setReset}
            label={s.more.grandFinalReset}
            hint={s.more.grandFinalResetHint}
          />
        )}

        {tooFew && <p className={form.hint}>{s.more.tooFewPlayers}</p>}
      </div>
    </Sheet>
  );
}
