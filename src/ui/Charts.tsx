import { useMemo, useState } from 'react';
import { Avatar, WinLossBar } from './Data';
import { cx } from '../lib/cx';
import css from './Charts.module.css';

export interface Series {
  id: string;
  name: string;
  color: string;
  /** Rating after each recorded match, starting with the base rating. */
  points: number[];
}

const PAD = { top: 10, right: 12, bottom: 22, left: 34 };

function niceTicks(min: number, max: number, count = 4): number[] {
  if (max - min < 1e-6) return [min];
  const rawStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * magnitude);
  const step = candidates.find((c) => c >= rawStep) ?? candidates[candidates.length - 1]!;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-6; v += step) ticks.push(Math.round(v));
  return ticks;
}

/**
 * Multi-series Elo progression. X axis is "matches played" rather than time so
 * players who joined late still line up on a comparable scale.
 */
export function EloLineChart({
  series,
  height = 190,
  emptyLabel = 'Noch keine Spiele',
}: {
  series: Series[];
  height?: number;
  emptyLabel?: string;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const width = 320;

  const visible = series.filter((s) => !hidden.has(s.id));
  const maxLen = Math.max(0, ...series.map((s) => s.points.length));

  const bounds = useMemo(() => {
    const values = visible.flatMap((s) => s.points);
    if (values.length === 0) return null;
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (max - min < 40) {
      const mid = (max + min) / 2;
      min = mid - 20;
      max = mid + 20;
    }
    const pad = (max - min) * 0.12;
    return { min: min - pad, max: max + pad };
  }, [visible]);

  if (maxLen < 2 || !bounds) {
    return <div className={css.emptyChart}>{emptyLabel}</div>;
  }

  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const lastX = Math.max(1, maxLen - 1);
  const x = (i: number) => PAD.left + (i / lastX) * innerW;
  const y = (v: number) =>
    PAD.top + innerH - ((v - bounds.min) / (bounds.max - bounds.min)) * innerH;

  const ticks = niceTicks(bounds.min, bounds.max, 4);
  const xTickStep = Math.max(1, Math.ceil(lastX / 5));

  return (
    <div>
      <svg
        className={css.chart}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Elo-Verlauf"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className={css.grid} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            <text className={css.axisText} x={PAD.left - 6} y={y(t) + 3} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        <line
          className={css.baseline}
          x1={PAD.left}
          x2={width - PAD.right}
          y1={height - PAD.bottom}
          y2={height - PAD.bottom}
        />
        {Array.from({ length: Math.floor(lastX / xTickStep) + 1 }, (_, k) => k * xTickStep).map(
          (i) => (
            <text
              key={i}
              className={css.axisText}
              x={x(i)}
              y={height - PAD.bottom + 13}
              textAnchor="middle"
            >
              {i}
            </text>
          ),
        )}
        {visible.map((s) => {
          const d = s.points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(v)}`).join(' ');
          const lastIndex = s.points.length - 1;
          const lastValue = s.points[lastIndex];
          return (
            <g key={s.id}>
              <path className={css.line} d={d} stroke={s.color} />
              {lastValue !== undefined && (
                <circle
                  className={css.dot}
                  cx={x(lastIndex)}
                  cy={y(lastValue)}
                  r={3.2}
                  fill={s.color}
                />
              )}
            </g>
          );
        })}
      </svg>
      {series.length > 1 && (
        <div className={css.legend}>
          {series.map((s) => {
            const off = hidden.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={!off}
                className={cx(css.legendItem, off && css.legendMuted)}
                onClick={() =>
                  setHidden((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.id)) next.delete(s.id);
                    else next.add(s.id);
                    return next;
                  })
                }
              >
                <span className={css.swatch} style={{ background: s.color }} />
                {s.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface WinLossRow {
  id: string;
  name: string;
  wins: number;
  losses: number;
  color?: string;
}

export function WinLossChart({ rows }: { rows: WinLossRow[] }) {
  if (rows.length === 0) {
    return <div className={css.emptyChart}>Noch keine Spiele</div>;
  }
  return (
    <div>
      {rows.map((row) => {
        const total = row.wins + row.losses;
        const pct = total === 0 ? 0 : Math.round((row.wins / total) * 100);
        return (
          <div key={row.id} className={css.barRow}>
            <span className={css.barName}>
              <Avatar name={row.name} seed={row.id} size={24} color={row.color} />
              <span className={css.barNameText}>{row.name}</span>
            </span>
            <span className={css.barMeta}>
              {row.wins}&thinsp;/&thinsp;{row.losses} &middot; {pct}%
            </span>
            <span className={css.barTrack}>
              <WinLossBar wins={row.wins} losses={row.losses} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
