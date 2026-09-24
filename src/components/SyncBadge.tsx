import { useState } from 'react';
import { Icon, type IconName } from '../ui';
import { strings } from '../i18n';
import { useSyncStatus } from '../sync';
import { ShareSheet } from './ShareSheet';
import { UnlockSheet } from './UnlockSheet';
import css from './SyncBadge.module.css';

const s = strings;

/**
 * Compact sync indicator for the tournament tab bars. Only public
 * tournaments have one; local tournaments render nothing so the app bar
 * looks exactly as it did before.
 */
export function SyncBadge({ tournamentId }: { tournamentId: string }) {
  const status = useSyncStatus(tournamentId);
  const [shareOpen, setShareOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);

  if (status.visibility !== 'public') return null;

  const locked = status.error === 'locked';
  let icon: IconName = 'cloud';
  let label: string | null = null;
  let spinning = false;

  if (status.state === 'syncing') {
    icon = 'refresh';
    spinning = true;
  } else if (status.state === 'pending') {
    icon = 'cloud';
    label = s.sync.badgePending(status.pendingCount);
  } else if (status.state === 'error') {
    if (status.error === 'offline') {
      icon = 'cloudOff';
      label = s.sync.badgeOffline;
    } else if (locked) {
      icon = 'lock';
      label = s.sync.badgeLocked;
    } else {
      icon = 'cloudOff';
      label = s.sync.badgeError;
    }
  }

  return (
    <>
      <button
        type="button"
        className={css.badge}
        onClick={() => (locked ? setUnlockOpen(true) : setShareOpen(true))}
        aria-label={label ?? s.share.title}
      >
        <Icon name={icon} size={16} className={spinning ? css.spin : undefined} />
        {label && <span className={css.label}>{label}</span>}
      </button>
      <ShareSheet tournamentId={tournamentId} open={shareOpen} onClose={() => setShareOpen(false)} />
      <UnlockSheet
        open={unlockOpen}
        tournamentId={tournamentId}
        onClose={() => setUnlockOpen(false)}
        onUnlocked={() => setUnlockOpen(false)}
      />
    </>
  );
}
