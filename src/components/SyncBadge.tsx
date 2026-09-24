import { useState } from 'react';
import { Icon, type IconName } from '../ui';
import { strings } from '../i18n';
import { useSyncStatus } from '../sync';
import { UnlockSheet } from './UnlockSheet';
import css from './SyncBadge.module.css';

const s = strings;

/**
 * Compact sync *status* indicator for the tournament tab bars - purely
 * informational, not a share entry point (that's the dedicated ShareButton
 * next to it). Only public tournaments have one; local tournaments render
 * nothing so the app bar looks exactly as it did before. The one action it
 * keeps is tapping in while locked, which opens the unlock sheet - resolving
 * a sync error, not sharing.
 */
export function SyncBadge({ tournamentId }: { tournamentId: string }) {
  const status = useSyncStatus(tournamentId);
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

  const content = (
    <>
      <Icon name={icon} size={16} className={spinning ? css.spin : undefined} />
      {label && <span className={css.label}>{label}</span>}
    </>
  );

  if (!locked) {
    return (
      <span className={css.badge} role="status" aria-label={label ?? undefined}>
        {content}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className={css.badge}
        onClick={() => setUnlockOpen(true)}
        aria-label={label ?? s.sync.badgeLocked}
      >
        {content}
      </button>
      <UnlockSheet
        open={unlockOpen}
        tournamentId={tournamentId}
        onClose={() => setUnlockOpen(false)}
        onUnlocked={() => setUnlockOpen(false)}
      />
    </>
  );
}
