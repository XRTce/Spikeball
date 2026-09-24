import { useState } from 'react';
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
  Sheet,
  Shell,
  Skeleton,
  Stack,
  TextField,
} from '../ui';
import { Logo } from '../components/Logo';
import { strings, formatRelative } from '../i18n';
import { useTournamentList } from '../state/useTournament';
import { parseJoinInput, useServerAvailable, useSyncStatus } from '../sync';
import type { Tournament } from '../domain/types';
import css from './HomeScreen.module.css';

const s = strings;

function statusBadge(tournament: Tournament) {
  if (tournament.status === 'finished') {
    return (
      <Badge tone="neutral" icon="trophy">
        {s.more.statusFinished}
      </Badge>
    );
  }
  if (tournament.phase === 'tournament') {
    return (
      <Badge tone="brand" icon="bracket">
        {tournament.format ? s.formats[tournament.format] : s.play.tournamentTitle}
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
  const serverAvailable = useServerAvailable();
  const [joinOpen, setJoinOpen] = useState(false);

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
          <>
            {serverAvailable === true && (
              <Button
                variant="ghost"
                icon="qr"
                aria-label={s.sync.join.action}
                onClick={() => setJoinOpen(true)}
              />
            )}
            <Button
              variant="ghost"
              icon="settings"
              aria-label={s.settings.title}
              onClick={() => navigate('/settings')}
            />
          </>
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
                      <div className={css.rowBadges}>
                        {statusBadge(tournament)}
                        {tournament.visibility === 'public' && (
                          <PublicBadge tournamentId={tournament.id} />
                        )}
                      </div>
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
      <JoinSheet open={joinOpen} onClose={() => setJoinOpen(false)} />
    </Shell>
  );
}

/** Tiny "Öffentlich" chip with a pending dot, for one tournament row. */
function PublicBadge({ tournamentId }: { tournamentId: string }) {
  const status = useSyncStatus(tournamentId);
  return (
    <Badge tone="info" icon="cloud">
      {s.sync.publicBadge}
      {status.pendingCount > 0 && <span className={css.pendingDot} aria-hidden="true" />}
    </Badge>
  );
}

function JoinSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const parsed = input.trim() ? parseJoinInput(input.trim()) : null;
  const invalid = input.trim().length > 0 && !parsed;

  const submit = () => {
    if (!parsed) return;
    setInput('');
    onClose();
    navigate(`/t/${parsed}`);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={s.sync.join.title}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {s.common.cancel}
          </Button>
          <Button variant="primary" icon="arrowRight" disabled={!parsed} onClick={submit}>
            {s.sync.join.submit}
          </Button>
        </>
      }
    >
      <form
        className={css.joinForm}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          label={s.sync.join.inputLabel}
          placeholder={s.sync.join.inputPlaceholder}
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          autoFocus
          enterKeyHint="go"
          error={invalid ? s.sync.join.invalid : undefined}
        />
        <p className={css.joinHint}>{s.sync.join.inputHint}</p>
      </form>
    </Sheet>
  );
}
