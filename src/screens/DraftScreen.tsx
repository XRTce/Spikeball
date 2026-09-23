import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppBar,
  Avatar,
  Badge,
  Button,
  Card,
  NumberStepper,
  Screen,
  SectionTitle,
  Stack,
  Switch,
  useToast,
} from '../ui';
import { usePlayerColors } from '../state/playerColors';
import { strings } from '../i18n';
import { useTournamentView } from './TournamentLayout';
import {
  MIN_DRAFT_PLAYERS,
  isDraftComplete,
  pickPartner,
  startDraft,
  type DraftState,
} from '../domain/pairing/draft';
import { startDraftedBracket } from '../db/repo';
import { useGuardedAction } from '../state/useGuardedAction';
import { isLockedError, useSyncStatus } from '../sync';
import css from './PlayScreen.module.css';

const s = strings;

function clampEven(value: number, max: number): number {
  const clamped = Math.min(Math.max(value, MIN_DRAFT_PLAYERS), max);
  return clamped - (clamped % 2);
}

export function DraftScreen() {
  const view = useTournamentView();
  const navigate = useNavigate();
  const toast = useToast();
  const colors = usePlayerColors();
  const tournament = view.tournament!;
  const guard = useGuardedAction(tournament.id);
  const status = useSyncStatus(tournament.id);
  const syncLocked = status.isProtected && !status.unlocked;

  const ranked = useMemo(
    () =>
      [...view.activePlayers].sort(
        (a, b) =>
          (view.ratings[b.id] ?? b.baseElo) - (view.ratings[a.id] ?? a.baseElo) ||
          a.name.localeCompare(b.name, 'de'),
      ),
    [view.activePlayers, view.ratings],
  );

  const [size, setSize] = useState(() =>
    clampEven(tournament.timedMode?.draftSize ?? 8, ranked.length),
  );
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [thirdPlace, setThirdPlace] = useState(tournament.play.thirdPlaceMatch);
  const [busy, setBusy] = useState(false);

  const nameOf = (id: string) => view.playerById.get(id)?.name ?? '?';
  const eloOf = (id: string) => view.ratings[id] ?? view.playerById.get(id)?.elo ?? 0;

  const back = `/t/${tournament.id}/more`;

  if (!draft) {
    return (
      <>
        <AppBar title={s.draft.title} subtitle={tournament.name} back={back} />
        <Screen>
          <Stack>
            <p className={css.pickerCount}>{s.draft.setupHint}</p>
            <NumberStepper
              label={s.draft.setupTitle}
              value={size}
              onChange={(value) => setSize(clampEven(value, ranked.length))}
              min={MIN_DRAFT_PLAYERS}
              max={clampEven(ranked.length, ranked.length)}
              step={2}
            />
            {ranked.length < MIN_DRAFT_PLAYERS ? (
              <p className={css.pickerCount}>{s.draft.tooFewPlayers}</p>
            ) : (
              <Button
                variant="primary"
                size="lg"
                icon="bracket"
                block
                onClick={() => {
                  const topIds = ranked.slice(0, size).map((player) => player.id);
                  setDraft(startDraft(topIds, view.ratings, tournament.elo.baseElo));
                }}
              >
                {s.draft.setupConfirm}
              </Button>
            )}
          </Stack>
        </Screen>
      </>
    );
  }

  if (!isDraftComplete(draft)) {
    const captain = draft.order[0]!;
    return (
      <>
        <AppBar title={s.draft.title} subtitle={tournament.name} back={back} />
        <Screen>
          <Stack>
            <Card padded>
              <div className={css.suggestionHead}>
                <span className={css.suggestionTitle}>{s.draft.captainPicks(nameOf(captain))}</span>
                <Badge tone="brand">{eloOf(captain)}</Badge>
              </div>
            </Card>

            <div className={css.pickerGrid}>
              {draft.pool.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={css.pickerItem}
                  onClick={() => setDraft(pickPartner(draft, id))}
                >
                  <Avatar name={nameOf(id)} seed={id} size={28} color={colors.varOf(id)} />
                  <span className={css.pickerName}>
                    {nameOf(id)}
                    <br />
                    <span className={css.pickerElo}>
                      {eloOf(id)} {s.common.elo}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            {draft.teams.length > 0 && (
              <>
                <SectionTitle>{s.draft.teamsSoFar}</SectionTitle>
                <Stack>
                  {draft.teams.map((team) => (
                    <div key={team.captain} className={css.pickerItem}>
                      <span className={css.pickerName}>
                        {nameOf(team.captain)} &amp; {nameOf(team.partner)}
                      </span>
                    </div>
                  ))}
                </Stack>
              </>
            )}
          </Stack>
        </Screen>
      </>
    );
  }

  return (
    <>
      <AppBar title={s.draft.confirmTitle} subtitle={tournament.name} back={back} />
      <Screen>
        <Stack>
          <SectionTitle>{s.draft.teamsSoFar}</SectionTitle>
          <Stack>
            {draft.teams.map((team) => (
              <div key={team.captain} className={css.pickerItem}>
                <span className={css.pickerName}>
                  {nameOf(team.captain)} &amp; {nameOf(team.partner)}
                </span>
              </div>
            ))}
          </Stack>

          {draft.teams.length >= 4 && (
            <Switch checked={thirdPlace} onChange={setThirdPlace} label={s.more.thirdPlace} />
          )}

          <Button
            variant="primary"
            size="lg"
            icon="check"
            iconAfter={syncLocked ? 'lock' : undefined}
            block
            busy={busy}
            onClick={() => {
              setBusy(true);
              guard.run(async () => {
                try {
                  await startDraftedBracket({
                    tournamentId: tournament.id,
                    teams: draft.teams.map((team) => ({ playerIds: [team.captain, team.partner] })),
                    thirdPlaceMatch: draft.teams.length >= 4 && thirdPlace,
                  });
                  toast.success(s.draft.created);
                  navigate(`/t/${tournament.id}`);
                } catch (error) {
                  if (isLockedError(error)) throw error;
                  toast.error(error instanceof Error ? error.message : s.errors.generic);
                  setBusy(false);
                }
              });
            }}
          >
            {s.draft.bracketCreate}
          </Button>
        </Stack>
      </Screen>
      {guard.sheet}
    </>
  );
}
