import { Badge, Button, Sheet, useToast } from '../ui';
import { QrCode } from './QrCode';
import { strings } from '../i18n';
import { shareUrl, useSyncStatus } from '../sync';
import css from './ShareSheet.module.css';

const s = strings;

export function ShareSheet({
  tournamentId,
  open,
  onClose,
}: {
  tournamentId: string;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const status = useSyncStatus(tournamentId);
  const url = shareUrl(tournamentId);

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(s.share.copied);
    } catch {
      toast.error(s.errors.generic);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={s.share.title} subtitle={s.share.scanHint}>
      <div className={css.body}>
        <div className={css.qrWrap}>
          <QrCode value={url} size={220} />
        </div>
        <p className={css.link}>{url}</p>
        <div className={css.actions}>
          <Button variant="secondary" icon="copy" onClick={() => void copyLink()}>
            {s.share.copyLink}
          </Button>
          {canShare && (
            <Button
              variant="secondary"
              icon="share"
              onClick={() =>
                void navigator.share({ title: s.share.title, url }).catch(() => {})
              }
            >
              {s.share.action}
            </Button>
          )}
        </div>
        {!status.uploaded && (
          <div className={css.notice}>
            <Badge tone="warn" icon="cloudOff">
              {s.share.notUploadedYet}
            </Badge>
          </div>
        )}
      </div>
    </Sheet>
  );
}
