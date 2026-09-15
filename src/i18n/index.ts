import { de, type Strings } from './de';

/**
 * The app ships German only. Copy is looked up through this module rather than
 * inlined so adding a locale means adding one file with the same shape and
 * switching the export here.
 */
export const strings: Strings = de;
export type { Strings };

const numberFormat = new Intl.NumberFormat('de-DE');
const dateFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short' });
const dateTimeFormat = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function formatDate(timestamp: number): string {
  return dateFormat.format(timestamp);
}

export function formatDateTime(timestamp: number): string {
  return dateTimeFormat.format(timestamp);
}

/** "gerade eben", "vor 3 Std." ... falls back to a date after a week. */
export function formatRelative(timestamp: number, now = Date.now()): string {
  const seconds = Math.round((now - timestamp) / 1000);
  if (seconds < 60) return 'gerade eben';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (days < 7) return `vor ${days} ${days === 1 ? 'Tag' : 'Tagen'}`;
  return formatDate(timestamp);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

/** Joins names the way German prose does: "A, B und C". */
export function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}
