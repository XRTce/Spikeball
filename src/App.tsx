import { Route, Routes } from 'react-router-dom';
import { HomeScreen } from './screens/HomeScreen';
import { CreateTournamentScreen } from './screens/CreateTournamentScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TournamentLayout, TournamentTabs } from './screens/TournamentLayout';
import { PlayScreen } from './screens/PlayScreen';
import { PlayersScreen } from './screens/PlayersScreen';
import { TableScreen } from './screens/TableScreen';
import { MoreScreen } from './screens/MoreScreen';
import { PlayerDetailScreen } from './screens/PlayerDetailScreen';
import { ExportScreen } from './screens/ExportScreen';
import { DraftScreen } from './screens/DraftScreen';
import { useEffect } from 'react';
import { NotFoundScreen } from './screens/NotFoundScreen';
import { UpdatePrompt } from './components/UpdatePrompt';
import { SyncNotices } from './components/SyncNotices';
import { startSyncEngine } from './sync';

export function App() {
  // Flushes queued changes for public tournaments on connectivity/visibility
  // changes and on a timer; a no-op while nothing is public yet. Started here
  // rather than main.tsx, which the sync engine itself owns.
  useEffect(() => {
    startSyncEngine();
  }, []);

  return (
    <>
      <UpdatePrompt />
      <SyncNotices />
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/new" element={<CreateTournamentScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/t/:tournamentId" element={<TournamentLayout />}>
          <Route element={<TournamentTabs />}>
            <Route index element={<PlayScreen />} />
            <Route path="players" element={<PlayersScreen />} />
            <Route path="table" element={<TableScreen />} />
            <Route path="more" element={<MoreScreen />} />
          </Route>
          <Route path="player/:playerId" element={<PlayerDetailScreen />} />
          <Route path="export" element={<ExportScreen />} />
          <Route path="draft" element={<DraftScreen />} />
        </Route>
        <Route path="*" element={<NotFoundScreen />} />
      </Routes>
    </>
  );
}
