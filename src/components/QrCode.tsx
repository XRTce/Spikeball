import { useMemo } from 'react';
import { encode } from 'uqr';

/** Modules of quiet zone around the code, per the QR spec's recommended minimum. */
const QUIET_ZONE = 4;

/**
 * Renders a QR code as one SVG path over a white plate, so it keeps enough
 * contrast to scan even when the app is in dark mode. `encode()` already adds
 * a border, so it is asked for none and the quiet zone is added here instead,
 * keeping the exact size predictable for the plate.
 *
 * `colorScheme: 'light'` tells the browser this element is intentionally
 * light-on-dark-module, not an unstyled light element that forgot to support
 * dark mode. Without it, browsers/WebViews with an auto-darkening setting for
 * web content (common on Android) repaint the white plate dark, which turns
 * the code into light-on-dark and makes it unreadable to most scanners.
 */
export function QrCode({ value, size = 220 }: { value: string; size?: number }) {
  const { path, modules } = useMemo(() => {
    const qr = encode(value, { border: 0, ecc: 'M' });
    const n = qr.size;
    let d = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (qr.data[y]?.[x]) {
          d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
        }
      }
    }
    return { path: d, modules: n + QUIET_ZONE * 2 };
  }, [value]);

  return (
    <svg
      viewBox={`0 0 ${modules} ${modules}`}
      width={size}
      height={size}
      role="img"
      aria-label={value}
      shapeRendering="crispEdges"
      style={{ background: '#fff', borderRadius: 'var(--radius-md)', colorScheme: 'light' }}
    >
      <path d={path} fill="#0b1220" />
    </svg>
  );
}
