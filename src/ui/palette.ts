/**
 * Categorical series colours as literal hex.
 *
 * The app itself uses the theme-aware `--series-*` custom properties; the
 * exported image is drawn on a canvas where CSS variables do not exist, so
 * both read their colour from the same index here.
 */
export const SERIES_COLORS = [
  '#ff6b2c',
  '#2dd4bf',
  '#818cf8',
  '#f472b6',
  '#38bdf8',
  '#a3e635',
  '#f59e0b',
  '#a78bfa',
  '#f87171',
  '#06b6d4',
  '#d4a017',
  '#94a3b8',
] as const;

export const SERIES_COUNT = SERIES_COLORS.length;

/** Stable 32-bit string hash (FNV-1a). */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seriesIndex(seed: string): number {
  return hashString(seed) % SERIES_COUNT;
}

/** Hex colour for a seed - used by the canvas export. */
export function seriesHex(seed: string): string {
  return SERIES_COLORS[seriesIndex(seed)]!;
}

/** CSS custom property for a seed - used by the live UI, so it follows the theme. */
export function seriesVar(seed: string): string {
  return `var(--series-${seriesIndex(seed) + 1})`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
