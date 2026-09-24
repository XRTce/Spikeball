import { useState } from 'react';
import { Button } from '../ui';
import { strings } from '../i18n';
import { useServerAvailable, useSyncStatus } from '../sync';
import { ShareSheet } from './ShareSheet';
import { PublishSheet } from './PublishSheet';

const s = strings;

/**
 * The one explicit "share with friends" entry point in the tournament app
 * bars - always visible, decoupled from sync *status* (that's SyncBadge's
 * job). A public tournament opens the QR/link sheet directly; a private one
 * walks straight into publishing first, then opens it. Hidden only when
 * sharing is genuinely impossible: a private tournament with no sync server
 * reachable to publish it to.
 */
export function ShareButton({ tournamentId }: { tournamentId: string }) {
  const status = useSyncStatus(tournamentId);
  const serverAvailable = useServerAvailable();
  const [shareOpen, setShareOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const isPublic = status.visibility === 'public';
  if (!isPublic && serverAvailable !== true) return null;

  return (
    <>
      <Button
        variant="ghost"
        icon="share"
        aria-label={isPublic ? s.share.title : s.sync.more.publishAction}
        onClick={() => (isPublic ? setShareOpen(true) : setPublishOpen(true))}
      />
      <ShareSheet tournamentId={tournamentId} open={shareOpen} onClose={() => setShareOpen(false)} />
      {!isPublic && (
        <PublishSheet
          open={publishOpen}
          tournamentId={tournamentId}
          onClose={() => setPublishOpen(false)}
          onPublished={() => {
            setPublishOpen(false);
            setShareOpen(true);
          }}
        />
      )}
    </>
  );
}
