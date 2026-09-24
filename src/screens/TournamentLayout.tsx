import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom';
import { AppBar, Button, EmptyState, Screen, Shell, TabBar, useToast, type TabItem } from '../ui';
import { ShareSheet } from '../components/ShareSheet';
import { strings } from '../i18n';
import { useTournament, type TournamentView } from '../state/useTournament';
import { PlayerColorProvider } from '../state/playerColors';
import { SyncError, joinTournament, useLiveSync, type SyncErrorCode } from '../sync';
import { NotFoundScreen } from './NotFoundScreen';
import { LoadingScreen } from './LoadingScreen';

const s = strings;

export function TournamentLayout() {
  const { tournamentId } = useParams();
  const location = useLocation();
  const view = useTournament(tournamentId);
  const toast = useToast();
  useLiveSync(tournamentId);

  const [shareOpen, setShareOpen] = useState(
    Boolean((location.state as { openShareSheet?: boolean } | null)?.openShareSheet),
  );

  // A tournament that is not in IndexedDB yet might still be a public one this
  // device has never opened - try to join it once before giving up on it.
  const [joinState, setJoinState] = useState<'idle' | 'joining' | 'error'>('idle');
  const [joinError, setJoinError] = useState<SyncErrorCode | 'unknown'>('unknown');
  const attempted = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (view.loading || view.tournament || !tournamentId) return;
    if (attempted.current === tournamentId) return;
    attempted.current = tournamentId;
    setJoinState('joining');
    joinTournament(tournamentId)
      .then(() => {
        setJoinState('idle');
        toast.show(s.sync.join.sharedBanner, { tone: 'info' });
      })
      .catch((error: unknown) => {
        setJoinState('error');
        setJoinError(
          error instanceof SyncError && error.code !== 'wrong_password' ? error.code : 'unknown',
        );
      });
  }, [tournamentId, toast, view.loading, view.tournament]);

  if (view.loading) return <LoadingScreen />;

  if (!view.tournament) {
    if (joinState === 'joining') return <JoiningScreen />;
    if (joinState === 'error') {
      if (joinError === 'not_found' || joinError === 'deleted') return <NotFoundScreen />;
      return (
        <JoinErrorScreen
          code={joinError}
          onRetry={() => {
            attempted.current = undefined;
            setJoinState('idle');
          }}
        />
      );
    }
    return <LoadingScreen />;
  }

  return (
    <PlayerColorProvider players={view.players}>
      <Shell>
        <Outlet context={view} />
      </Shell>
      {tournamentId && (
        <ShareSheet tournamentId={tournamentId} open={shareOpen} onClose={() => setShareOpen(false)} />
      )}
    </PlayerColorProvider>
  );
}

function JoiningScreen() {
  return (
    <Shell>
      <Screen>
        <EmptyState icon="cloud" title={s.sync.join.loading} />
      </Screen>
    </Shell>
  );
}

function JoinErrorScreen({
  code,
  onRetry,
}: {
  code: SyncErrorCode | 'unknown';
  onRetry: () => void;
}) {
  const text =
    code === 'offline'
      ? s.sync.join.offlineText
      : code === 'unavailable'
        ? s.sync.join.unavailableText
        : s.sync.errors.unknown;
  return (
    <Shell>
      <AppBar title={s.sync.join.title} back="/" />
      <Screen>
        <EmptyState
          icon="cloudOff"
          title={text}
          action={
            <Button variant="primary" icon="refresh" onClick={onRetry}>
              {s.sync.join.retry}
            </Button>
          }
        />
      </Screen>
    </Shell>
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
