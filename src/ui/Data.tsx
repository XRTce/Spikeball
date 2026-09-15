import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import css from './Data.module.css';

/* ---- Badge -------------------------------------------------------------- */
export type BadgeTone = 'neutral' | 'brand' | 'accent' | 'win' | 'loss' | 'warn' | 'info';

const badgeTone = {
  neutral: css.badgeNeutral,
  brand: css.badgeBrand,
  accent: css.badgeAccent,
  win: css.badgeWin,
  loss: css.badgeLoss,
  warn: css.badgeWarn,
  info: css.badgeInfo,
} satisfies Record<BadgeTone, string | undefined>;

export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: BadgeTone;
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <span className={`${css.badge} ${badgeTone[tone]}`}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

/* ---- Avatar ------------------------------------------------------------- */
export { hashString, initials, seriesVar as seriesColor } from './palette';
import { initials, seriesVar } from './palette';

export function Avatar({
  name,
  seed,
  size = 34,
  color,
}: {
  name: string;
  seed?: string;
  size?: number;
  color?: string;
}) {
  return (
    <span
      className={css.avatar}
      style={{
        width: size,
        height: size,
        background: color ?? seriesVar(seed ?? name),
        fontSize: Math.round(size * 0.38),
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({
  people,
  size = 30,
}: {
  people: { id: string; name: string; color?: string }[];
  size?: number;
}) {
  return (
    <span className={css.avatarStack}>
      {people.map((p) => (
        <Avatar key={p.id} name={p.name} seed={p.id} size={size} color={p.color} />
      ))}
    </span>
  );
}

/* ---- Elo delta ---------------------------------------------------------- */
export function EloDelta({ value, showZero = true }: { value: number; showZero?: boolean }) {
  if (value === 0 && !showZero) return null;
  const tone = value > 0 ? css.deltaUp : value < 0 ? css.deltaDown : css.deltaFlat;
  return (
    <span className={`${css.delta} ${tone}`}>
      {value > 0 ? <Icon name="arrowUp" size={11} /> : null}
      {value < 0 ? <Icon name="arrowDown" size={11} /> : null}
      {value > 0 ? '+' : ''}
      {value}
    </span>
  );
}

/* ---- Stats -------------------------------------------------------------- */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className={css.statGrid}>{children}</div>;
}

export function Stat({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className={css.stat}>
      <div className={css.statValue}>{value}</div>
      <div className={css.statLabel}>{label}</div>
    </div>
  );
}

/* ---- Table -------------------------------------------------------------- */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className={css.tableWrap}>{children}</div>;
}

export const tableClass = css.table;
/** Drops the lowest-value column below 26rem so the rating always fits. */
export const compactTableClass = css.compact;
export const rankCellClass = css.rankCell;
export const nameCellClass = css.nameCell;
export const nameTextClass = css.nameText;
export const highlightRowClass = css.highlight;

/* ---- Progress ----------------------------------------------------------- */
export function Progress({ value, max = 1 }: { value: number; max?: number }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className={css.progress} role="progressbar" aria-valuenow={Math.round(pct)}>
      <div className={css.progressFill} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function WinLossBar({ wins, losses }: { wins: number; losses: number }) {
  const total = wins + losses;
  const winPct = total === 0 ? 0 : (wins / total) * 100;
  return (
    <div className={css.ratio} aria-label={`${wins} Siege, ${losses} Niederlagen`}>
      <div className={css.ratioWin} style={{ width: `${winPct}%` }} />
      <div className={css.ratioLoss} style={{ width: `${100 - winPct}%` }} />
    </div>
  );
}

/* ---- Empty state -------------------------------------------------------- */
export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: IconName;
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={css.empty}>
      <div className={css.emptyIcon}>
        <Icon name={icon} size={26} />
      </div>
      <div className={css.emptyTitle}>{title}</div>
      {text && <p className={css.emptyText}>{text}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: string }) {
  return <div className={css.skeleton} style={{ height, width }} />;
}
