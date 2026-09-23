import { useEffect } from 'react';
import { strings } from '../i18n';
import { onSyncNotice } from '../sync';
import { useToast } from '../ui';

const s = strings;

/**
 * App-wide toasts for sync events that happen outside any button press -
 * a replay dropping a command, the server rejecting queued changes, or
 * someone deleting the tournament for everyone. Mounted once in App.tsx.
 */
export function SyncNotices() {
  const toast = useToast();

  useEffect(
    () =>
      onSyncNotice((notice) => {
        if (notice.kind === 'dropped') {
          toast.error(s.sync.notice.dropped(notice.count));
        } else if (notice.kind === 'locked') {
          toast.error(s.sync.notice.locked);
        } else if (notice.kind === 'deleted') {
          toast.show(s.sync.notice.deleted, { tone: 'info' });
        }
      }),
    [toast],
  );

  return null;
}
