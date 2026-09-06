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
import { cx } from '../lib/cx';
import { usePlayerColors } from '../state/playerColors';
import { strings } from '../i18n';
import { useTournamentView } from './TournamentLayout';
import { buildStandings } from '../domain/standings';
import { eloSeries } from '../domain/elo';
import type { MatchStage } from '../domain/types';
import css from './TableScreen.module.css';

const s = strings;

type Scope = 'all' | 'tournament' | 'casual';

const SCOPE_STAGES: Record<Scope, MatchStage[] | undefined> = {
  all: undefined,
  tournament: ['round_robin', 'swiss', 'winners', 'losers', 'grand_final', 'grand_final_reset', 'third_place'],
  casual: ['casual'],
};

export function TableScreen() {
  const view = useTournamentView();
  const navigate = useNavigate();
  const colors = usePlayerColors();
  const tournament = view.tournament!;
  const [scope, setScope] = useState<Scope>('all');

  const standings = useMemo(() => {
    const stages = SCOPE_STAGES[scope];
    return buildStandings(
      view.players,
      view.matches,
      view.replay,
      stages ? { stages } : {},
    );
  }, [scope, view.matches, view.players, view.replay]);

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
      <AppBar title={s.table.title} subtitle={tournament.name} back={`/t/${tournament.id}`} />
      <Screen withTabbar>
        <Stack>
          {hasTournamentMatches && (
            <div className={css.scope}>
              <Segmented
                ariaLabel="Zeitraum"
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
              <div className={css.card}>
                <TableWrap>
                  <table className={cx(tableClass, compactTableClass)}>
                    <thead>
                      <tr>
                        <th>{s.table.rank}</th>
                        <th>{s.table.name}</th>
                        <th>{s.table.played}</th>
                        <th>{s.table.wins}</th>
                        <th>{s.table.diff}</th>
                        <th>{s.table.elo}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((row, index) => (
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
                          <td>{row.played}</td>
                          <td>{row.wins}</td>
                          <td>{row.pointDiff > 0 ? `+${row.pointDiff}` : row.pointDiff}</td>
                          <td>
                            {row.elo} <EloDelta value={row.eloChange} showZero={false} />
                          </td>
                        </tr>
                      ))}
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
