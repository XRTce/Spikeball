import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppBar,
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  EloDelta,
  EmptyState,
  Icon,
  NumberStepper,
  Screen,
  SectionTitle,
  SelectField,
  Sheet,
  Stack,
  Switch,
  TextField,
  useToast,
} from '../ui';
import { OptionList } from '../components/OptionList';
import { cx } from '../lib/cx';
import { strings } from '../i18n';
import { usePlayerColors } from '../state/playerColors';
import { useTournamentView } from './TournamentLayout';
import { useTournamentList } from '../state/useTournament';
import { addPlayer, clonePlayersFrom, deletePlayer, updatePlayer } from '../db/repo';
import type { Player } from '../domain/types';
import css from './PlayersScreen.module.css';
import form from '../styles/forms.module.css';

const s = strings;

export function PlayersScreen() {
  const view = useTournamentView();
  const navigate = useNavigate();
  const toast = useToast();
  const colors = usePlayerColors();
  const tournament = view.tournament!;
  const allTournaments = useTournamentList() ?? [];

  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<Player | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Player | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);

  const locked = tournament.phase === 'tournament';

  const nameTaken = useMemo(
    () =>
      view.players.some(
        (player) => player.name.toLowerCase() === newName.trim().toLowerCase(),
      ),
    [newName, view.players],
  );

  const submitNew = async () => {
    const name = newName.trim();
    if (!name || nameTaken) return;
    await addPlayer(tournament.id, name);
    setNewName('');
  };

  return (
    <>
      <AppBar
        title={s.players.title}
        subtitle={tournament.name}
        back={`/t/${tournament.id}`}
        actions={
          allTournaments.length > 1 ? (
            <Button
              variant="ghost"
              icon="copy"
              aria-label={s.players.clone}
              onClick={() => setCloneOpen(true)}
            />
          ) : null
        }
      />
      <Screen withTabbar>
        <Stack>
          {!locked && (
            <form
              className={css.addRow}
              onSubmit={(event) => {
                event.preventDefault();
                void submitNew();
              }}
            >
              <TextField
                placeholder={s.players.namePlaceholder}
                value={newName}
                onChange={(event) => setNewName(event.currentTarget.value)}
                maxLength={30}
                enterKeyHint="done"
                aria-label={s.players.add}
                error={newName.trim() && nameTaken ? s.players.duplicate : undefined}
              />
              <Button
                type="submit"
                variant="primary"
                icon="plus"
                aria-label={s.players.add}
                disabled={!newName.trim() || nameTaken}
              />
            </form>
          )}

          {view.players.length === 0 ? (
            <EmptyState
              icon="userPlus"
              title={s.players.empty}
              text={s.players.emptyText}
              action={
                allTournaments.length > 1 ? (
                  <Button variant="secondary" icon="copy" onClick={() => setCloneOpen(true)}>
                    {s.players.clone}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <SectionTitle>
                {view.players.length} {s.common.players}
              </SectionTitle>
              <div className={css.list}>
                {view.players.map((player) => {
                  const rating = view.ratings[player.id] ?? player.baseElo;
                  const played = view.replay.matchesPlayed[player.id] ?? 0;
                  return (
                    <div
                      key={player.id}
                      className={cx(css.row, !player.active && css.inactive)}
                    >
                      <Avatar
                        name={player.name}
                        seed={player.id}
                        size={38}
                        color={colors.varOf(player.id)}
                      />
                      <button
                        type="button"
                        className={css.info}
                        style={{ textAlign: 'left' }}
                        onClick={() => navigate(`/t/${tournament.id}/player/${player.id}`)}
                      >
                        <div className={css.name}>{player.name}</div>
                        <div className={css.meta}>
                          <span>{s.players.played(played)}</span>
                          <EloDelta value={rating - player.baseElo} showZero={false} />
                          {player.inTournament && <Badge tone="brand">Turnier</Badge>}
                        </div>
                      </button>
                      <div className={css.elo}>
                        <div className={css.eloValue}>{rating}</div>
                        <div className={css.eloBase}>von {player.baseElo}</div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={player.active}
                        aria-label={player.active ? s.players.active : s.players.inactive}
                        className={cx(css.toggle, player.active && css.toggleOn)}
                        onClick={() => void updatePlayer(player.id, { active: !player.active })}
                      >
                        <span className={css.knob} />
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="pencil"
                        aria-label={s.players.edit}
                        onClick={() => setEditing(player)}
                        style={{ gridColumn: '4' }}
                      />
                    </div>
                  );
                })}
              </div>
              <p className={form.hint}>{s.players.activeHint}</p>
            </>
          )}
        </Stack>
      </Screen>

      <EditPlayerSheet
        player={editing}
        onClose={() => setEditing(null)}
        onDelete={(player) => {
          setEditing(null);
          setConfirmDelete(player);
        }}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title={s.players.deleteTitle}
        message={confirmDelete ? s.players.deleteText(confirmDelete.name) : ''}
        confirmLabel={s.common.delete}
        destructive
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void deletePlayer(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />

      <ClonePlayersSheet
        open={cloneOpen}
        onClose={() => setCloneOpen(false)}
        currentId={tournament.id}
        onDone={(count) => {
          setCloneOpen(false);
          toast.success(`${count} ${count === 1 ? 'Spieler' : 'Spieler'} uebernommen`);
        }}
      />
    </>
  );
}

function EditPlayerSheet({
  player,
  onClose,
  onDelete,
}: {
  player: Player | null;
  onClose: () => void;
  onDelete: (player: Player) => void;
}) {
  const [name, setName] = useState('');
  const [baseElo, setBaseElo] = useState(1000);
  const [active, setActive] = useState(true);

  // Re-seed the form whenever a different player is opened.
  useEffect(() => {
    if (!player) return;
    setName(player.name);
    setBaseElo(player.baseElo);
    setActive(player.active);
  }, [player]);

  if (!player) return null;

  return (
    <Sheet
      open
      onClose={onClose}
      title={s.players.edit}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {s.common.cancel}
          </Button>
          <Button
            variant="primary"
            icon="check"
            onClick={async () => {
              await updatePlayer(player.id, { name: name.trim() || player.name, baseElo, active });
              onClose();
            }}
          >
            {s.common.save}
          </Button>
        </>
      }
    >
      <div className={css.editForm}>
        <TextField
          label={s.players.namePlaceholder}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          maxLength={30}
        />
        <NumberStepper
          label={s.players.startElo}
          hint="Alle Spiele werden neu berechnet"
          value={baseElo}
          onChange={setBaseElo}
          min={100}
          max={3000}
          step={25}
        />
        <Switch checked={active} onChange={setActive} label={s.players.active} />
        <Button variant="dangerGhost" icon="trash" onClick={() => onDelete(player)}>
          {s.common.delete}
        </Button>
      </div>
    </Sheet>
  );
}

function ClonePlayersSheet({
  open,
  onClose,
  currentId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  currentId: string;
  onDone: (count: number) => void;
}) {
  const entries = (useTournamentList() ?? []).filter(
    (entry) => entry.tournament.id !== currentId && entry.players > 0,
  );
  const [sourceId, setSourceId] = useState('');
  const [ratingSource, setRatingSource] = useState<'current' | 'base'>('current');
  const [busy, setBusy] = useState(false);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={s.players.clone}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {s.common.cancel}
          </Button>
          <Button
            variant="primary"
            icon="copy"
            disabled={!sourceId}
            busy={busy}
            onClick={async () => {
              if (!sourceId) return;
              setBusy(true);
              const count = await clonePlayersFrom(currentId, sourceId, ratingSource);
              setBusy(false);
              onDone(count);
            }}
          >
            {s.common.add}
          </Button>
        </>
      }
    >
      <div className={css.cloneList}>
        {entries.length === 0 ? (
          <p className={form.hint}>Es gibt kein anderes Turnier mit Spielern.</p>
        ) : (
          <>
            <SelectField
              label="Turnier"
              value={sourceId}
              onChange={(event) => setSourceId(event.currentTarget.value)}
            >
              <option value="">Bitte waehlen</option>
              {entries.map(({ tournament, players }) => (
                <option key={tournament.id} value={tournament.id}>
                  {tournament.name} ({players})
                </option>
              ))}
            </SelectField>
            <OptionList
              ariaLabel={s.create.cloneRating}
              value={ratingSource}
              onChange={setRatingSource}
              options={[
                { value: 'current', label: s.create.cloneCurrent },
                { value: 'base', label: s.create.cloneBase },
              ]}
            />
            <p className={form.hint}>{s.create.cloneHint}</p>
            <p className={form.hint}>
              <Icon name="info" size={13} /> Namen, die es hier schon gibt, werden uebersprungen.
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}
