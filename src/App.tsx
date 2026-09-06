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
import { NotFoundScreen } from './screens/NotFoundScreen';
import { UpdatePrompt } from './components/UpdatePrompt';

export function App() {
  return (
    <>
      <UpdatePrompt />
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
        </Route>
        <Route path="*" element={<NotFoundScreen />} />
      </Routes>
    </>
  );
}
