import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Icon } from '../ui';
import { strings } from '../i18n';
import css from './QrScanner.module.css';

const s = strings;

type ScannerStatus = 'starting' | 'scanning' | 'denied' | 'unavailable' | 'unsupported' | 'error';

const STATUS_MESSAGE: Record<Exclude<ScannerStatus, 'scanning'>, string> = {
  starting: s.sync.join.scanStarting,
  denied: s.sync.join.cameraDenied,
  unavailable: s.sync.join.cameraUnavailable,
  unsupported: s.sync.join.cameraUnsupported,
  error: s.sync.join.cameraError,
};

/**
 * Live camera QR scanner. Opens the back camera, decodes frames with jsQR
 * (works in Safari/iOS too, unlike the experimental BarcodeDetector API),
 * and calls `onScan` with the decoded text as soon as a code locks - the
 * caller decides whether that text is a usable join link.
 *
 * The decode loop keeps running after a call to `onScan`: the caller's join
 * link may turn out not to parse (a QR code for something else entirely),
 * and the person should be able to keep pointing the camera at codes without
 * reopening the sheet. To avoid calling `onScan` on every single frame while
 * the same code just sits in view, it is only called again once a *different*
 * value decodes. The stream itself is stopped on unmount - which callers
 * trigger by closing the sheet or switching away from scan mode once a valid
 * code is found - so it never keeps the camera open once this component is
 * gone.
 */
export function QrScanner({ onScan }: { onScan: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<ScannerStatus>('starting');

  // Read through a ref so the capture effect below can stay mount-only: a
  // fresh `onScan` identity on every parent render must never restart the
  // camera mid-scan.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      return;
    }

    let cancelled = false;
    let lastValue: string | null = null;
    let stream: MediaStream | null = null;
    let frameId: number | null = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const stop = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    const tick = () => {
      const video = videoRef.current;
      if (cancelled || !video || !ctx) return;
      if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(frame.data, frame.width, frame.height);
        if (code && code.data && code.data !== lastValue) {
          lastValue = code.data;
          onScanRef.current(code.data);
        }
      }
      frameId = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
          setStatus('denied');
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
          setStatus('unavailable');
        } else {
          setStatus('error');
        }
        return;
      }

      if (cancelled || !videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const video = videoRef.current;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay can reject if the element was removed mid-await; the
        // cleanup below still tears the stream down either way.
      }
      if (cancelled) return;

      setStatus('scanning');
      frameId = requestAnimationFrame(tick);
    })();

    return () => {
      cancelled = true;
      stop();
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
  }, []);

  const message = status === 'scanning' ? null : STATUS_MESSAGE[status];

  return (
    <div className={css.wrap}>
      <div className={css.frame}>
        <video ref={videoRef} className={css.video} muted playsInline aria-hidden="true" />
        {message && (
          <div className={css.overlay}>
            <Icon
              name={status === 'denied' ? 'lock' : status === 'starting' ? 'camera' : 'cloudOff'}
              size={28}
            />
            <p className={css.overlayText}>{message}</p>
          </div>
        )}
        {status === 'scanning' && <div className={css.reticle} aria-hidden="true" />}
      </div>
      {status === 'scanning' && <p className={css.hint}>{s.sync.join.scanHint}</p>}
    </div>
  );
}
