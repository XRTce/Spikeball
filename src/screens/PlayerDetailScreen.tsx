import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  AppBar,
  Avatar,
  EloDelta,
  EmptyState,
  Screen,
  SectionTitle,
  Stack,
  Stat,
  StatGrid,
  WinLossBar,
} from '../ui';
import { EloLineChart } from '../ui/Charts';
import { MatchCard } from '../components/MatchCard';
import { strings } from '../i18n';
import { usePlayerColors } from '../state/playerColors';
import { useTournamentView } from './TournamentLayout';
import { eloSeries, isRatedMatch } from '../domain/elo';
import { headToHead } from '../domain/standings';
import css from './PlayerDetailScreen.module.css';

const s = strings;

export function PlayerDetailScreen() {
  const { playerId } = useParams();
  const view = useTournamentView();
  const colors = usePlayerColors();
  const tournament = view.tournament!;
  const player = playerId ? view.playerById.get(playerId) : undefined;

  const row = view.standings.find((entry) => entry.playerId === playerId);

  const matches = useMemo(
    () =>
      view.matches
        .filter(
          (match) =>
            isRatedMatch(match) &&
            (match.teamA.includes(playerId ?? '') || match.teamB.includes(playerId ?? '')),
        )
        .sort((a, b) => b.sequence - a.sequence),
    [playerId, view.matches],
  );

  const series = useMemo(() => {
    if (!player) return [];
    const curves = eloSeries(view.replay, [player.id]);
    return [
      {
        id: player.id,
        name: player.name,
        color: colors.varOf(player.id),
        points: curves[player.id] ?? [],
      },
    ];
  }, [colors, player, view.replay]);

  const partners = useMemo(() => {
    if (!player) return [];
    return view.players
      .filter((other) => other.id !== player.id)
      .map((other) => ({ other, ...headToHead(view.matches, player.id, other.id) }))
      .filter((entry) => entry.asPartners.played > 0 || entry.asOpponents[0] + entry.asOpponents[1] > 0)
      .sort(
        (a, b) =>
          b.asPartners.played + b.asOpponents[0] + b.asOpponents[1] -
          (a.asPartners.played + a.asOpponents[0] + a.asOpponents[1]),
      );
  }, [player, view.matches, view.players]);

  if (!player) {
    return (
      <>
        <AppBar title={s.errors.notFound} back={`/t/${tournament.id}/players`} />
        <Screen>
          <EmptyState icon="user" title={s.errors.notFound} />
        </Screen>
      </>
    );
  }

  const rating = view.ratings[player.id] ?? player.baseElo;

  return (
    <>
      <AppBar title={player.name} subtitle={tournament.name} back={`/t/${tournament.id}/players`} />
      <Screen>
        <Stack>
          <div className={css.hero}>
            <Avatar name={player.name} seed={player.id} size={64} color={colors.varOf(player.id)} />
            <div className={css.heroText}>
              <div className={css.heroElo}>
                {rating}
                <EloDelta value={rating - player.baseElo} showZero={false} />
              </div>
              <div className={css.heroMeta}>
                {s.create.baseElo}: {player.baseElo}
              </div>
            </div>
          </div>

          <StatGrid>
            <Stat value={row?.played ?? 0} label={s.common.matches} />
            <Stat value={row?.wins ?? 0} label={s.table.wins} />
            <Stat value={row?.losses ?? 0} label={s.table.losses} />
            <Stat
              value={`${Math.round((row?.winRate ?? 0) * 100)}%`}
              label="Siegquote"
            />
          </StatGrid>

          {(row?.played ?? 0) > 0 && (
            <div className={css.ratioCard}>
              <WinLossBar wins={row?.wins ?? 0} losses={row?.losses ?? 0} />
            </div>
          )}

          <SectionTitle>{s.table.eloProgress}</SectionTitle>
          <div className={css.chartCard}>
            <EloLineChart series={series} height={170} />
          </div>

          {partners.length > 0 && (
            <>
              <SectionTitle>Bilanz gegen und mit</SectionTitle>
              <div className={css.relations}>
                {partners.map(({ other, asPartners, asOpponents }) => (
                  <div key={other.id} className={css.relationRow}>
                    <Avatar name={other.name} seed={other.id} size={28} color={colors.varOf(other.id)} />
                    <span className={css.relationName}>{other.name}</span>
                    <span className={css.relationMeta}>
                      {asOpponents[0] + asOpponents[1] > 0 && (
                        <span>
                          gegen {asOpponents[0]}:{asOpponents[1]}
                        </span>
                      )}
                      {asPartners.played > 0 && (
                        <span>
                          mit {asPartners.wins}/{asPartners.played}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {matches.length > 0 && (
            <>
              <SectionTitle>{s.play.recent}</SectionTitle>
              <div className={css.matchList}>
                {matches.slice(0, 20).map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    playerById={view.playerById}
                    deltas={view.replay.perMatch[match.id]?.delta}
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
