import { Outlet, useOutletContext, useParams } from 'react-router-dom';
import { Shell, TabBar, type TabItem } from '../ui';
import { strings } from '../i18n';
import { useTournament, type TournamentView } from '../state/useTournament';
import { PlayerColorProvider } from '../state/playerColors';
import { NotFoundScreen } from './NotFoundScreen';
import { LoadingScreen } from './LoadingScreen';

export function TournamentLayout() {
  const { tournamentId } = useParams();
  const view = useTournament(tournamentId);

  if (view.loading) return <LoadingScreen />;
  if (!view.tournament) return <NotFoundScreen />;

  return (
    <PlayerColorProvider players={view.players}>
      <Shell>
        <Outlet context={view} />
      </Shell>
    </PlayerColorProvider>
  );
}

/** The four main tabs. Pushed screens sit outside this so they lose the bar. */
export function TournamentTabs() {
  const view = useTournamentView();
  const base = `/t/${view.tournament!.id}`;

  const openMatches = view.matches.filter(
    (match) =>
      match.status === 'scheduled' && match.teamA.length > 0 && match.teamB.length > 0,
  ).length;

  const items: TabItem[] = [
    { to: base, label: strings.tabs.play, icon: 'play', badge: openMatches > 0 },
    { to: `${base}/players`, label: strings.tabs.players, icon: 'users' },
    { to: `${base}/table`, label: strings.tabs.table, icon: 'chart' },
    { to: `${base}/more`, label: strings.tabs.more, icon: 'settings' },
  ];

  return (
    <>
      <Outlet context={view} />
      <TabBar items={items} />
    </>
  );
}

/** Typed access to the tournament read model provided by the layout. */
export function useTournamentView(): TournamentView & { tournamentId: string } {
  const view = useOutletContext<TournamentView>();
  return { ...view, tournamentId: view.tournament?.id ?? '' };
}
