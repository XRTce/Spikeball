import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar,
  AvatarStack,
  Button,
  EloDelta,
  EmptyState,
  Icon,
  Screen,
  SectionTitle,
  Stack,
} from '../ui';
import { EloLineChart, WinLossChart, type Series, type WinLossRow } from '../ui/Charts';
import { cx } from '../lib/cx';
import { usePlayerColors } from '../state/playerColors';
import { strings } from '../i18n';
import { useTournamentView } from './TournamentLayout';
import { eloSeries } from '../domain/elo';
import { resolveFinalPodium, type FinalPodiumEntry } from '../domain/standings';
import css from './TournamentFinishedScreen.module.css';

const s = strings;

const MAX_SERIES = 6;
const MAX_ROWS = 10;

const RANK_LABEL: Record<1 | 2 | 3, string> = {
  1: s.podium.first,
  2: s.podium.second,
  3: s.podium.third,
};

// A little suspense: the lower ranks land first, the winner last.
const REVEAL_DELAY: Record<1 | 2 | 3, number> = { 3: 0, 2: 110, 1: 240 };

const CONFETTI_COLORS = [
  'var(--brand-500)',
  'var(--accent-500)',
  'var(--gold)',
  'var(--series-3)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-8)',
];

const CONFETTI_PIECES = Array.from({ length: 18 }, (_, i) => ({
  id: i,
  // Deterministic scatter (not Math.random()) so the burst looks the same
  // shape every time rather than reshuffling on every re-render.
  left: (i * 53) % 100,
  delayMs: (i % 9) * 70,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
  alt: i % 2 === 1,
}));

interface PodiumCard {
  rank: 1 | 2 | 3;
  name: string;
  people: { id: string; name: string; color: string }[];
  elo: number;
  delta: number;
}

/**
 * Celebration screen shown the moment a tournament is complete: podium,
 * Elo curve and win/loss - the same building blocks the table and export
 * screens use, reached instantly instead of the user having to go find them.
 */
export function TournamentFinishedScreen() {
  const view = useTournamentView();
  const navigate = useNavigate();
  const location = useLocation();
  const colors = usePlayerColors();
  const tournament = view.tournament!;

  // Only set by PlayScreen's own submit handler, the instant a result finishes
  // the tournament - a manual "finish" (the fallback button, MoreScreen, a
  // plain revisit) shows the same screen without replaying the burst.
  const celebrate = Boolean((location.state as { celebrate?: boolean } | null)?.celebrate);

  const hasResults = view.standings.some((row) => row.played > 0);

  const podiumCards = useMemo<PodiumCard[]>(() => {
    const mean = (values: number[]) =>
      values.length === 0 ? 0 : Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);

    const entries: FinalPodiumEntry[] = resolveFinalPodium(
      tournament.format,
      view.tournamentMatches,
      view.standings,
    );

    return entries.map(({ rank, playerIds }) => {
      const ratings = playerIds.map((id) => view.ratings[id] ?? 0);
      const bases = playerIds.map((id) => view.playerById.get(id)?.baseElo ?? 0);
      return {
        rank,
        name: playerIds.map((id) => view.playerById.get(id)?.name ?? '?').join(' & '),
        people: playerIds.map((id) => ({
          id,
          name: view.playerById.get(id)?.name ?? '?',
          color: colors.varOf(id),
        })),
        elo: mean(ratings),
        delta: mean(ratings) - mean(bases),
      };
    });
  }, [colors, tournament.format, view.playerById, view.ratings, view.standings, view.tournamentMatches]);

  const chartRows = useMemo(
    () => view.standings.filter((row) => row.played > 0).slice(0, MAX_SERIES),
    [view.standings],
  );

  const series = useMemo<Series[]>(() => {
    const curves = eloSeries(
      view.replay,
      chartRows.map((row) => row.playerId),
    );
    return chartRows.map((row) => ({
      id: row.playerId,
      name: row.name,
      color: colors.varOf(row.playerId),
      points: curves[row.playerId] ?? [],
    }));
  }, [chartRows, colors, view.replay]);

  const winLossRows = useMemo<WinLossRow[]>(
    () =>
      view.standings
        .filter((row) => row.played > 0)
        .slice(0, MAX_ROWS)
        .map((row) => ({
          id: row.playerId,
          name: row.name,
          wins: row.wins,
          losses: row.losses,
          color: colors.varOf(row.playerId),
        })),
    [colors, view.standings],
  );

  return (
    <>
      <AppBar title={s.play.finished} subtitle={tournament.name} back={`/t/${tournament.id}`} />
      {celebrate && <ConfettiBurst />}
      <Screen>
        {!hasResults ? (
          <EmptyState icon="trophy" title={s.finished.noResults} />
        ) : (
          <Stack>
            <p className={css.intro}>{s.finished.intro}</p>

            <SectionTitle>{s.exportImage.podium}</SectionTitle>
            <div className={css.podium}>
              {podiumCards.map((card) => (
                <div
                  key={card.rank}
                  className={cx(css.podiumCol, css[`rank${card.rank}`])}
                  style={{ animationDelay: `${REVEAL_DELAY[card.rank]}ms` }}
                >
                  {card.rank === 1 && (
                    <span className={css.podiumTrophy}>
                      <Icon name="trophy" size={22} />
                    </span>
                  )}
                  <AvatarStack people={card.people} size={card.rank === 1 ? 46 : 36} />
                  <span className={css.podiumName}>{card.name}</span>
                  <span className={css.podiumEloRow}>
                    {card.elo}
                    <EloDelta value={card.delta} showZero={false} />
                  </span>
                  <div className={css.podiumStep}>
                    <span className={css.podiumStepRank}>{card.rank}</span>
                    <span className={css.podiumStepLabel}>{RANK_LABEL[card.rank]}</span>
                  </div>
                </div>
              ))}
            </div>

            <SectionTitle>{s.table.eloProgress}</SectionTitle>
            <div className={cx(css.card, css.chartCard)}>
              <EloLineChart series={series} />
            </div>

            <SectionTitle>{s.table.winLoss}</SectionTitle>
            <div className={cx(css.card, css.chartCard)}>
              <WinLossChart rows={winLossRows} />
            </div>

            <div className={css.actions}>
              <Button
                variant="primary"
                size="lg"
                icon="chart"
                block
                onClick={() => navigate(`/t/${tournament.id}/table`)}
              >
                {s.finished.viewTable}
              </Button>
              <Button variant="secondary" block onClick={() => navigate(`/t/${tournament.id}`)}>
                {s.finished.backToPlay}
              </Button>
            </div>
          </Stack>
        )}
      </Screen>
    </>
  );
}

function ConfettiBurst() {
  return (
    <div className={css.confetti} aria-hidden="true">
      {CONFETTI_PIECES.map((piece) => (
        <span
          key={piece.id}
          className={cx(css.confettiPiece, piece.alt && css.confettiPieceAlt)}
          style={{ left: `${piece.left}%`, animationDelay: `${piece.delayMs}ms`, background: piece.color }}
        />
      ))}
    </div>
  );
}
