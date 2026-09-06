import { useNavigate } from 'react-router-dom';
import {
  AppBar,
  Badge,
  Button,
  CardButton,
  EmptyState,
  FloatingAction,
  Icon,
  Screen,
  SectionTitle,
  Shell,
  Skeleton,
  Stack,
} from '../ui';
import { Logo } from '../components/Logo';
import { strings, formatRelative } from '../i18n';
import { useTournamentList } from '../state/useTournament';
import type { Tournament } from '../domain/types';
import css from './HomeScreen.module.css';

const s = strings;

function statusBadge(tournament: Tournament) {
  if (tournament.status === 'finished') {
    return (
      <Badge tone="neutral" icon="trophy">
        Beendet
      </Badge>
    );
  }
  if (tournament.phase === 'tournament') {
    return (
      <Badge tone="brand" icon="bracket">
        {tournament.format ? s.formats[tournament.format] : 'Turnier'}
      </Badge>
    );
  }
  return (
    <Badge tone="accent" icon="play">
      {s.play.casualTitle}
    </Badge>
  );
}

export function HomeScreen() {
  const navigate = useNavigate();
  const entries = useTournamentList();

  return (
    <Shell>
      <AppBar
        title={
          <span className={css.brand}>
            <Logo size={26} className={css.brandMark} />
            <span className={css.brandName}>{s.app.name}</span>
          </span>
        }
        actions={
          <Button
            variant="ghost"
            icon="settings"
            aria-label={s.settings.title}
            onClick={() => navigate('/settings')}
          />
        }
      />
      <Screen withTabbar>
        {entries === undefined ? (
          <Stack>
            <Skeleton height={86} />
            <Skeleton height={86} />
          </Stack>
        ) : entries.length === 0 ? (
          <>
            <div className={css.hero}>
              <h2 className={css.heroTitle}>{s.app.tagline}</h2>
              <p className={css.heroText}>{s.home.emptyText}</p>
            </div>
            <EmptyState
              icon="trophy"
              title={s.home.empty}
              text=""
              action={
                <Button variant="primary" icon="plus" onClick={() => navigate('/new')}>
                  {s.home.create}
                </Button>
              }
            />
          </>
        ) : (
          <>
            <SectionTitle>{s.home.title}</SectionTitle>
            <div className={css.list}>
              {entries.map(({ tournament, players, matches }) => (
                <CardButton
                  key={tournament.id}
                  onClick={() => navigate(`/t/${tournament.id}`)}
                  aria-label={tournament.name}
                >
                  <div className={css.row}>
                    <div className={css.rowText}>
                      <div className={css.rowTitle}>
                        <span className={css.rowName}>{tournament.name}</span>
                      </div>
                      <div className={css.rowBadges}>{statusBadge(tournament)}</div>
                      <div className={css.rowMeta}>
                        {s.home.playerCount(players)} &middot; {s.home.matchCount(matches)} &middot;{' '}
                        {formatRelative(tournament.updatedAt)}
                      </div>
                    </div>
                    <Icon name="chevronRight" size={20} className={css.chevron} />
                  </div>
                </CardButton>
              ))}
            </div>
          </>
        )}
      </Screen>
      {entries !== undefined && entries.length > 0 && (
        <FloatingAction>
          <Button variant="primary" size="lg" icon="plus" block onClick={() => navigate('/new')}>
            {s.home.create}
          </Button>
        </FloatingAction>
      )}
    </Shell>
  );
}
