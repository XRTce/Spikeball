import { useNavigate } from 'react-router-dom';
import { AppBar, Button, EmptyState, Screen, Shell } from '../ui';
import { strings } from '../i18n';

export function NotFoundScreen() {
  const navigate = useNavigate();
  return (
    <Shell>
      <AppBar title={strings.errors.notFound} />
      <Screen>
        <EmptyState
          icon="search"
          title={strings.errors.notFound}
          text={strings.errors.notFoundText}
          action={
            <Button variant="primary" icon="home" onClick={() => navigate('/')}>
              {strings.home.title}
            </Button>
          }
        />
      </Screen>
    </Shell>
  );
}
