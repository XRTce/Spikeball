import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppBar,
  AvatarStack,
  Badge,
  Button,
  EmptyState,
  Progress,
  Screen,
  SectionTitle,
  Stack,
  Tabs,
  useToast,
} from '../ui';
import { MatchCard, ResultSheet, teamLabel } from '../components/MatchCard';
import { PlayerPickerSheet } from '../components/PlayerPickerSheet';
import { AvailablePlayersSheet } from '../components/AvailablePlayersSheet';
import { SyncBadge } from '../components/SyncBadge';
import { strings } from '../i18n';
import { useTournamentView } from './TournamentLayout';
import { groupRounds, scheduleProgress } from '../domain/schedule';
import { eliminationSize } from '../domain/pairing/elimination';
import { suggestCasualMatch } from '../domain/pairing/casual';
import { matchWinProbability } from '../domain/elo';
import {
  clearMatchResult,
  deleteMatch,
  finishTournament,
  scheduleCasualMatch,
  setMatchResult,
} from '../db/repo';
import { useTimedModeCountdown } from '../state/timedMode';
import { useAvailablePlayers } from '../state/availablePlayers';
import { useGuardedAction } from '../state/useGuardedAction';
import type { Match, Player } from '../domain/types';
import css from './PlayScreen.module.css';

const s = strings;

export function PlayScreen() {
  const view = useTournamentView();
  const toast = useToast();
  const tournament = view.tournament!;
  const guard = useGuardedAction(tournament.id);

  const [resultMatch, setResultMatch] = useState<Match | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [availableIds, setAvailableIds] = useAvailablePlayers(tournament.id, view.activePlayers);
  const [seed, setSeed] = useState(1);
  const [activeRound, setActiveRound] = useState<string | null>(null);

  const isTournament = tournament.phase === 'tournament';

  const resultSheet = (
    <ResultSheet
      match={resultMatch}
      playerById={view.playerById}
      play={tournament.play}
      onClose={() => setResultMatch(null)}
      onSubmit={(matchId, a, b) =>
        guard.run(() => setMatchResult(matchId, a, b).then(() => setResultMatch(null)))
      }
      onClear={(matchId) =>
        guard.run(() => clearMatchResult(matchId).then(() => setResultMatch(null)))
      }
      onDelete={(matchId) =>
        guard.run(() => deleteMatch(matchId).then(() => setResultMatch(null)))
      }
    />
  );

  if (isTournament) {
    return (
      <>
        <TournamentPlay
          activeRound={activeRound}
          setActiveRound={setActiveRound}
          onEnterResult={setResultMatch}
          runGuarded={guard.run}
        />
        {resultSheet}
        {guard.sheet}
      </>
    );
  }

  const eligiblePlayers = availableIds
    ? view.activePlayers.filter((player) => availableIds.has(player.id))
    : view.activePlayers;

  return (
    <>
      <CasualPlay
        seed={seed}
        eligiblePlayers={eligiblePlayers}
        filterActive={availableIds !== null}
        onReshuffle={() => setSeed((value) => value + 1)}
        onEnterResult={setResultMatch}
        onOpenPicker={() => setPickerOpen(true)}
        onOpenAvailability={() => setAvailabilityOpen(true)}
        runGuarded={guard.run}
      />
      {resultSheet}
      {guard.sheet}
      <PlayerPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        players={eligiblePlayers}
        ratings={view.ratings}
        teamSize={view.teamSize}
        onConfirm={(teamA, teamB) =>
          guard.run(async () => {
            await scheduleCasualMatch(tournament.id, teamA, teamB);
            setPickerOpen(false);
            toast.success('Spiel steht auf dem Platz');
          })
        }
      />
      <AvailablePlayersSheet
        open={availabilityOpen}
        onClose={() => setAvailabilityOpen(false)}
        players={view.activePlayers}
        ratings={view.ratings}
        selected={availableIds ?? new Set(view.activePlayers.map((p) => p.id))}
        onConfirm={(ids) => {
          setAvailableIds(new Set(ids));
          setAvailabilityOpen(false);
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Casual queue                                                              */
/* ------------------------------------------------------------------------ */

function CasualPlay({
  seed,
  eligiblePlayers,
  filterActive,
  onReshuffle,
  onEnterResult,
  onOpenPicker,
  onOpenAvailability,
  runGuarded,
}: {
  seed: number;
  eligiblePlayers: Player[];
  filterActive: boolean;
  onReshuffle: () => void;
  onEnterResult: (match: Match) => void;
  onOpenPicker: () => void;
  onOpenAvailability: () => void;
  runGuarded: (fn: () => unknown) => void;
}) {
  const view = useTournamentView();
  const tournament = view.tournament!;
  const navigate = useNavigate();
  const needed = view.teamSize * 2;
  const countdown = useTimedModeCountdown(tournament.timedMode);

  const onCourt = useMemo(
    () =>
      view.casualMatches
        .filter((match) => match.status === 'scheduled')
        .sort((a, b) => a.createdAt - b.createdAt),
    [view.casualMatches],
  );

  const recent = useMemo(
    () =>
      view.casualMatches
        .filter((match) => match.status === 'done')
        .sort((a, b) => b.sequence - a.sequence)
        .slice(0, 12),
    [view.casualMatches],
  );

  // Players already on the pitch are not offered for the next match.
  const busy = new Set(onCourt.flatMap((match) => [...match.teamA, ...match.teamB]));
  const available = eligiblePlayers.filter((player) => !busy.has(player.id));

  const maxPartnerRepeats = tournament.timedMode?.maxPartnerRepeats ?? null;

  const suggestion = useMemo(
    () =>
      suggestCasualMatch({
        candidates: available.map((player) => player.id),
        ratings: view.ratings,
        fallbackRating: tournament.elo.baseElo,
        history: view.history,
        teamSize: view.teamSize,
        seed,
        maxPartnerRepeats,
      }),
    [available, maxPartnerRepeats, seed, tournament.elo.baseElo, view.history, view.ratings, view.teamSize],
  );

  const probability = suggestion
    ? matchWinProbability(
        suggestion.teamA,
        suggestion.teamB,
        view.ratings,
        tournament.elo.baseElo,
      )
    : 0.5;

  return (
    <>
      <AppBar
        title={tournament.name}
        subtitle={s.play.casualTitle}
        back="/"
        actions={<SyncBadge tournamentId={tournament.id} />}
      />
      <Screen withTabbar>
        <Stack>
          {tournament.timedMode && (
            <Badge tone={countdown?.expired ? 'warn' : 'neutral'} icon="clock">
              {!tournament.timedMode.timerStartedAt
                ? s.more.timerNotStarted(tournament.timedMode.freePlayMinutes)
                : countdown?.expired
                  ? s.more.timerExpired
                  : countdown?.label}
            </Badge>
          )}
          {view.players.length > 0 && (
            <Button variant="secondary" icon="checkCircle" onClick={onOpenAvailability}>
              {filterActive
                ? s.play.availableCount(eligiblePlayers.length, view.activePlayers.length)
                : s.play.availablePlayers}
            </Button>
          )}
          {view.players.length === 0 ? (
            <EmptyState
              icon="userPlus"
              title={s.play.noPlayers}
              text={s.play.noPlayersText}
              action={
                <Button
                  variant="primary"
                  icon="userPlus"
                  onClick={() => navigate(`/t/${tournament.id}/players`)}
                >
                  {s.play.addPlayers}
                </Button>
              }
            />
          ) : suggestion ? (
            <div className={css.suggestion}>
              <div className={css.suggestionHead}>
                <span className={css.suggestionTitle}>Nächstes Spiel</span>
                <Badge tone={Math.abs(probability - 0.5) < 0.06 ? 'accent' : 'neutral'}>
                  {Math.abs(probability - 0.5) < 0.06
                    ? s.play.even
                    : s.play.favourite(Math.round(Math.max(probability, 1 - probability) * 100))}
                </Badge>
              </div>

              <div className={css.teams}>
                <div className={css.team}>
                  <AvatarStack
                    people={suggestion.teamA.map((id) => ({
                      id,
                      name: view.playerById.get(id)?.name ?? '?',
                    }))}
                    size={34}
                  />
                  <span className={css.teamNames}>
                    {teamLabel(suggestion.teamA, view.playerById)}
                  </span>
                </div>
                <span className={css.vs}>vs</span>
                <div className={css.team}>
                  <AvatarStack
                    people={suggestion.teamB.map((id) => ({
                      id,
                      name: view.playerById.get(id)?.name ?? '?',
                    }))}
                    size={34}
                  />
                  <span className={css.teamNames}>
                    {teamLabel(suggestion.teamB, view.playerById)}
                  </span>
                </div>
              </div>

              <div className={css.actions}>
                <Button
                  variant="primary"
                  size="lg"
                  icon="play"
                  block
                  onClick={() =>
                    runGuarded(() =>
                      scheduleCasualMatch(tournament.id, suggestion.teamA, suggestion.teamB),
                    )
                  }
                >
                  {s.play.startMatch}
                </Button>
                <div className={css.actionRow}>
                  <Button variant="secondary" icon="shuffle" onClick={onReshuffle}>
                    {s.play.reshuffle}
                  </Button>
                  <Button variant="secondary" icon="users" onClick={onOpenPicker}>
                    {s.play.chooseManually}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              icon="users"
              title={s.play.needMorePlayers(needed)}
              text={s.players.emptyText}
            />
          )}

          {onCourt.length > 0 && (
            <>
              <SectionTitle>{s.play.currentMatches}</SectionTitle>
              <div className={css.list}>
                {onCourt.map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    playerById={view.playerById}
                    ratings={view.ratings}
                    baseElo={tournament.elo.baseElo}
                    showProbability
                    onEnterResult={onEnterResult}
                  />
                ))}
              </div>
            </>
          )}

          {recent.length > 0 && (
            <>
              <SectionTitle>{s.play.recent}</SectionTitle>
              <div className={css.list}>
                {recent.map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    playerById={view.playerById}
                    deltas={view.replay.perMatch[match.id]?.delta}
                    onEnterResult={onEnterResult}
                  />
                ))}
              </div>
            </>
          )}
        </Stack>
      </Screen>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Tournament schedule                                                       */
/* ------------------------------------------------------------------------ */

function TournamentPlay({
  activeRound,
  setActiveRound,
  onEnterResult,
  runGuarded,
}: {
  activeRound: string | null;
  setActiveRound: (key: string) => void;
  onEnterResult: (match: Match) => void;
  runGuarded: (fn: () => unknown) => void;
}) {
  const view = useTournamentView();
  const tournament = view.tournament!;

  const groups = useMemo(() => groupRounds(view.matches), [view.matches]);
  const progress = useMemo(() => {
    const bracket = tournament.bracket;
    const expected = bracket
      ? eliminationSize(bracket.teams.length, tournament.play.thirdPlaceMatch).matches
      : undefined;
    return scheduleProgress(view.matches, expected);
  }, [tournament.bracket, tournament.play.thirdPlaceMatch, view.matches]);

  // Default to the first round that still has something to play.
  const fallbackKey =
    groups.find((group) => group.playable > group.played)?.key ??
    groups[groups.length - 1]?.key ??
    '';
  const currentKey = activeRound && groups.some((g) => g.key === activeRound)
    ? activeRound
    : fallbackKey;
  const current = groups.find((group) => group.key === currentKey);

  const everythingPlayed = progress.total > 0 && progress.played === progress.total;

  return (
    <>
      <AppBar
        title={tournament.name}
        subtitle={tournament.format ? s.formats[tournament.format] : s.play.tournamentTitle}
        back="/"
        actions={<SyncBadge tournamentId={tournament.id} />}
      />
      <Screen withTabbar>
        <Stack>
          <div className={css.progressRow}>
            <div className={css.progressText}>
              <div className={css.progressTitle}>
                {tournament.status === 'finished' ? s.play.finished : s.more.running}
              </div>
              <div className={css.progressMeta}>
                {progress.played} von {progress.total} {s.common.matches}
              </div>
              <div className={css.progressBar}>
                <Progress value={progress.played} max={Math.max(1, progress.total)} />
              </div>
            </div>
          </div>

          {groups.length > 1 && (
            <div className={css.tabsWrap}>
              <Tabs
                ariaLabel={s.common.round}
                value={currentKey}
                onChange={setActiveRound}
                options={groups.map((group) => ({
                  value: group.key,
                  label: group.complete ? `${group.shortLabel} ✓` : group.shortLabel,
                }))}
              />
            </div>
          )}

          {current && (
            <>
              <div className={css.roundHead}>
                <span className={css.roundTitle}>{current.label}</span>
                <Badge tone={current.complete ? 'win' : 'neutral'}>
                  {current.played}/{current.playable}
                </Badge>
              </div>
              <div className={css.list}>
                {current.matches.map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    playerById={view.playerById}
                    deltas={view.replay.perMatch[match.id]?.delta}
                    ratings={view.ratings}
                    baseElo={tournament.elo.baseElo}
                    showProbability
                    onEnterResult={onEnterResult}
                  />
                ))}
              </div>
            </>
          )}

          {everythingPlayed && tournament.status !== 'finished' && (
            <Button
              variant="primary"
              size="lg"
              icon="trophy"
              block
              onClick={() => runGuarded(() => finishTournament(tournament.id))}
            >
              {s.play.finish}
            </Button>
          )}
        </Stack>
      </Screen>
    </>
  );
}
