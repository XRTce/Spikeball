import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppBar,
  Avatar,
  EloDelta,
  EmptyState,
  Screen,
  SectionTitle,
  Segmented,
  Stack,
  TableWrap,
  nameCellClass,
  nameTextClass,
  rankCellClass,
  compactTableClass,
  tableClass,
} from '../ui';
import { EloLineChart, WinLossChart, type Series } from '../ui/Charts';
import { SyncBadge } from '../components/SyncBadge';
import { ShareButton } from '../components/ShareButton';
import { cx } from '../lib/cx';
import { usePlayerColors } from '../state/playerColors';
import { strings } from '../i18n';
import { useTournamentView } from './TournamentLayout';
import {
  buildStandings,
  compareByElo,
  compareByKey,
  statsFor,
  type StandingsFormatView,
  type StandingsSortKey,
} from '../domain/standings';
import { eloSeries } from '../domain/elo';
import type { MatchStage } from '../domain/types';
import css from './TableScreen.module.css';

const s = strings;

type Scope = 'all' | 'tournament' | 'casual';

const SCOPE_STAGES: Record<Scope, MatchStage[] | undefined> = {
  all: undefined,
  tournament: ['winners', 'third_place'],
  casual: ['casual'],
};

// Column order matches the table; `label` is the header, `name` the spoken form.
const SORT_COLUMNS: { key: StandingsSortKey; label: string; name: string }[] = [
  { key: 'name', label: s.table.name, name: s.table.name },
  { key: 'played', label: s.table.played, name: s.table.sortPlayed },
  { key: 'wins', label: s.table.wins, name: s.table.sortWins },
  { key: 'winRate', label: s.table.winRateShort, name: s.table.winRate },
  { key: 'elo', label: s.table.elo, name: s.table.elo },
];

// Filters matches, wins and win rate; rank, rating and the charts stay overall.
const FORMAT_OPTIONS: { value: StandingsFormatView; label: string }[] = [
  { value: 'all', label: s.table.formatAll },
  { value: 'bo1', label: s.table.formatBo1 },
  { value: 'bo3', label: s.table.formatBo3 },
];

export function TableScreen() {
  const view = useTournamentView();
  const navigate = useNavigate();
  const colors = usePlayerColors();
  const tournament = view.tournament!;
  const [scope, setScope] = useState<Scope>('all');
  const [sortKey, setSortKey] = useState<StandingsSortKey>('elo');
  const [formatView, setFormatView] = useState<StandingsFormatView>('all');

  const standings = useMemo(() => {
    const stages = SCOPE_STAGES[scope];
    return buildStandings(
      view.players,
      view.matches,
      view.replay,
      stages ? { stages } : {},
    ).sort(compareByElo);
  }, [scope, view.matches, view.players, view.replay]);

  // Rank and medals always follow the rating order; only the row order changes.
  const rankOf = useMemo(
    () => new Map(standings.map((row, index) => [row.playerId, index])),
    [standings],
  );
  const rows = useMemo(
    () => [...standings].sort(compareByKey(sortKey, formatView)),
    [standings, sortKey, formatView],
  );

  const played = standings.reduce((sum, row) => sum + row.played, 0);

  // The chart gets crowded past ten lines; the rest stay in the table.
  const chartPlayers = useMemo(
    () => standings.filter((row) => row.played > 0).slice(0, 10),
    [standings],
  );

  const series = useMemo<Series[]>(() => {
    const curves = eloSeries(
      view.replay,
      chartPlayers.map((row) => row.playerId),
    );
    return chartPlayers.map((row) => ({
      id: row.playerId,
      name: row.name,
      color: colors.varOf(row.playerId),
      points: curves[row.playerId] ?? [],
    }));
  }, [chartPlayers, colors, view.replay]);

  const hasTournamentMatches = view.tournamentMatches.length > 0;

  return (
    <>
      <AppBar
        title={s.table.title}
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
          {hasTournamentMatches && (
            <div className={css.scope}>
              <Segmented
                ariaLabel={s.table.scope}
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'all', label: s.table.scopeAll },
                  { value: 'tournament', label: s.table.scopeTournament },
                  { value: 'casual', label: s.table.scopeCasual },
                ]}
              />
            </div>
          )}

          {played === 0 ? (
            <EmptyState icon="chart" title={s.table.empty} text={s.table.emptyText} />
          ) : (
            <>
              <div className={css.formatView}>
                <Segmented
                  ariaLabel={s.table.formatView}
                  value={formatView}
                  onChange={setFormatView}
                  options={FORMAT_OPTIONS}
                />
              </div>
              <div className={css.card}>
                <TableWrap>
                  <table className={cx(tableClass, compactTableClass)}>
                    <thead>
                      <tr>
                        <th>{s.table.rank}</th>
                        {SORT_COLUMNS.map(({ key, label, name }) => (
                          <th
                            key={key}
                            className={key === 'name' ? css.headLeft : undefined}
                            aria-sort={
                              sortKey === key
                                ? key === 'name'
                                  ? 'ascending'
                                  : 'descending'
                                : undefined
                            }
                          >
                            <button
                              type="button"
                              className={cx(css.sortButton, sortKey === key && css.sortActive)}
                              aria-label={s.table.sortByColumn(name)}
                              onClick={() => setSortKey(key)}
                            >
                              {label}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const index = rankOf.get(row.playerId) ?? 0;
                        const stats = statsFor(row, formatView);
                        return (
                          <tr
                            key={row.playerId}
                            className={css.row}
                            onClick={() =>
                              navigate(`/t/${tournament.id}/player/${row.playerId}`)
                            }
                          >
                            <td className={rankCellClass}>
                              {index < 3 && row.played > 0 ? (
                                <span
                                  className={cx(
                                    css.medal,
                                    index === 0 && css.gold,
                                    index === 1 && css.silver,
                                    index === 2 && css.bronze,
                                  )}
                                >
                                  {index + 1}
                                </span>
                              ) : (
                                index + 1
                              )}
                            </td>
                            <td>
                              <span className={nameCellClass}>
                                <Avatar
                                  name={row.name}
                                  seed={row.playerId}
                                  size={26}
                                  color={colors.varOf(row.playerId)}
                                />
                                <span className={nameTextClass}>{row.name}</span>
                                <span className={css.form}>
                                  {row.form.map((won, i) => (
                                    <span
                                      key={i}
                                      className={cx(
                                        css.formDot,
                                        won ? css.formWin : css.formLoss,
                                      )}
                                    />
                                  ))}
                                </span>
                              </span>
                            </td>
                            <td>{stats.played}</td>
                            <td>{stats.wins}</td>
                            <td>
                              {stats.played === 0
                                ? s.table.noGames
                                : `${Math.round(stats.winRate * 100)}%`}
                            </td>
                            <td>
                              {row.elo} <EloDelta value={row.eloChange} showZero={false} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>
              </div>

              <SectionTitle>{s.table.eloProgress}</SectionTitle>
              <div className={cx(css.card, css.chartCard)}>
                <EloLineChart series={series} />
              </div>

              <SectionTitle>{s.table.winLoss}</SectionTitle>
              <div className={cx(css.card, css.chartCard)}>
                <WinLossChart
                  rows={standings
                    .filter((row) => row.played > 0)
                    .map((row) => ({
                      id: row.playerId,
                      name: row.name,
                      wins: row.wins,
                      losses: row.losses,
                      color: colors.varOf(row.playerId),
                    }))}
                />
              </div>
            </>
          )}
        </Stack>
      </Screen>
    </>
  );
}
