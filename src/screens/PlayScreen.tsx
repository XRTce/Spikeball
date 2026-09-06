import { useMemo, useState } from 'react';
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
import { strings } from '../i18n';
import { useTournamentView } from './TournamentLayout';
import { groupRounds, openMatches, scheduleProgress } from '../domain/schedule';
import { eliminationSize } from '../domain/pairing/elimination';
import { suggestCasualMatch, splitChosenPlayers } from '../domain/pairing/casual';
import { matchWinProbability } from '../domain/elo';
import {
  clearMatchResult,
  deleteMatch,
  finishTournament,
  generateNextSwissRound,
  scheduleCasualMatch,
  setMatchResult,
} from '../db/repo';
import type { Match } from '../domain/types';
import css from './PlayScreen.module.css';

const s = strings;

export function PlayScreen() {
  const view = useTournamentView();
  const toast = useToast();
  const tournament = view.tournament!;

  const [resultMatch, setResultMatch] = useState<Match | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [seed, setSeed] = useState(1);
  const [activeRound, setActiveRound] = useState<string | null>(null);

  const isTournament = tournament.phase === 'tournament';

  const submitResult = async (matchId: string, scoreA: number, scoreB: number) => {
    await setMatchResult(matchId, scoreA, scoreB);
    setResultMatch(null);
  };

  const resultSheet = (
    <ResultSheet
      match={resultMatch}
      playerById={view.playerById}
      play={tournament.play}
      onClose={() => setResultMatch(null)}
      onSubmit={(matchId, a, b) => void submitResult(matchId, a, b)}
      onClear={(matchId) => {
        void clearMatchResult(matchId);
        setResultMatch(null);
      }}
      onDelete={(matchId) => {
        void deleteMatch(matchId);
        setResultMatch(null);
      }}
    />
  );

  if (isTournament) {
    return (
      <>
        <TournamentPlay
          activeRound={activeRound}
          setActiveRound={setActiveRound}
          onEnterResult={setResultMatch}
          onToast={(message) => toast.success(message)}
        />
        {resultSheet}
      </>
    );
  }

  return (
    <>
      <CasualPlay
        seed={seed}
        onReshuffle={() => setSeed((value) => value + 1)}
        onEnterResult={setResultMatch}
        onOpenPicker={() => setPickerOpen(true)}
      />
      {resultSheet}
      <PlayerPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        players={view.activePlayers}
        ratings={view.ratings}
        count={view.teamSize * 2}
        onConfirm={async (ids) => {
          const planned = splitChosenPlayers(ids, {
            ratings: view.ratings,
            fallbackRating: tournament.elo.baseElo,
            history: view.history,
            teamSize: view.teamSize,
          });
          if (!planned) return;
          await scheduleCasualMatch(tournament.id, planned.teamA, planned.teamB);
          setPickerOpen(false);
          toast.success('Spiel steht auf dem Platz');
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
  onReshuffle,
  onEnterResult,
  onOpenPicker,
}: {
  seed: number;
  onReshuffle: () => void;
  onEnterResult: (match: Match) => void;
  onOpenPicker: () => void;
}) {
  const view = useTournamentView();
  const tournament = view.tournament!;
  const needed = view.teamSize * 2;

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
  const available = view.activePlayers.filter((player) => !busy.has(player.id));

  const suggestion = useMemo(
    () =>
      suggestCasualMatch({
        candidates: available.map((player) => player.id),
        ratings: view.ratings,
        fallbackRating: tournament.elo.baseElo,
        history: view.history,
        teamSize: view.teamSize,
        seed,
      }),
    [available, seed, tournament.elo.baseElo, view.history, view.ratings, view.teamSize],
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
      />
      <Screen withTabbar>
        <Stack>
          {view.players.length === 0 ? (
            <EmptyState
              icon="userPlus"
              title={s.play.noPlayers}
              text={s.play.noPlayersText}
              action={
                <Button variant="primary" icon="userPlus" onClick={onOpenPicker} disabled>
                  {s.play.addPlayers}
                </Button>
              }
            />
          ) : suggestion ? (
            <div className={css.suggestion}>
              <div className={css.suggestionHead}>
                <span className={css.suggestionTitle}>Naechstes Spiel</span>
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
                    void scheduleCasualMatch(
                      tournament.id,
                      suggestion.teamA,
                      suggestion.teamB,
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
  onToast,
}: {
  activeRound: string | null;
  setActiveRound: (key: string) => void;
  onEnterResult: (match: Match) => void;
  onToast: (message: string) => void;
}) {
  const view = useTournamentView();
  const tournament = view.tournament!;

  const groups = useMemo(
    () => groupRounds(view.matches, tournament.format),
    [view.matches, tournament.format],
  );
  const progress = useMemo(() => {
    const bracket = tournament.bracket;
    const expected =
      bracket && tournament.format
        ? eliminationSize(bracket.teams.length, tournament.format, tournament.play.thirdPlaceMatch)
            .matches
        : undefined;
    return scheduleProgress(view.matches, expected);
  }, [tournament.bracket, tournament.format, tournament.play.thirdPlaceMatch, view.matches]);
  const open = useMemo(() => openMatches(view.tournamentMatches), [view.tournamentMatches]);

  // Default to the first round that still has something to play.
  const fallbackKey =
    groups.find((group) => group.playable > group.played)?.key ??
    groups[groups.length - 1]?.key ??
    '';
  const currentKey = activeRound && groups.some((g) => g.key === activeRound)
    ? activeRound
    : fallbackKey;
  const current = groups.find((group) => group.key === currentKey);

  const isSwiss = tournament.format === 'swiss';
  const lastSwissRound = view.tournamentMatches.reduce(
    (max, match) => (match.stage === 'swiss' ? Math.max(max, match.round) : max),
    0,
  );
  const canGenerateRound =
    isSwiss && open.length === 0 && lastSwissRound < tournament.play.swissRounds;

  const everythingPlayed = progress.total > 0 && progress.played === progress.total;

  return (
    <>
      <AppBar
        title={tournament.name}
        subtitle={tournament.format ? s.formats[tournament.format] : s.play.tournamentTitle}
        back="/"
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

          {canGenerateRound && (
            <Button
              variant="primary"
              size="lg"
              icon="plus"
              block
              onClick={async () => {
                const round = await generateNextSwissRound(tournament.id);
                if (round > 0) {
                  setActiveRound(`swiss:${round}`);
                  onToast(`${s.common.round} ${round} erstellt`);
                }
              }}
            >
              {s.play.nextRound}
            </Button>
          )}

          {everythingPlayed && tournament.status !== 'finished' && (
            <Button
              variant="primary"
              size="lg"
              icon="trophy"
              block
              onClick={() => void finishTournament(tournament.id)}
            >
              {s.play.finish}
            </Button>
          )}
        </Stack>
      </Screen>
    </>
  );
}
