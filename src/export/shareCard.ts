import { SERIES_COLORS, initials } from '../ui/palette';

/**
 * The result image is painted directly onto a canvas rather than rasterising
 * DOM nodes.
 *
 * Screenshotting the DOM (html-to-image and friends) goes through an SVG
 * foreignObject, which drops web fonts, mishandles CSS custom properties and
 * fails outright in some mobile browsers. Drawing the card by hand means the
 * output is byte-for-byte the same everywhere and never half-rendered.
 */

export interface PodiumEntry {
  rank: 1 | 2 | 3;
  name: string;
  elo: number;
  delta: number;
  color: string;
}

export interface SeriesEntry {
  name: string;
  color: string;
  points: number[];
}

export interface WinLossEntry {
  name: string;
  wins: number;
  losses: number;
  color: string;
}

export interface ShareCardData {
  title: string;
  subtitle: string;
  podium: PodiumEntry[];
  series: SeriesEntry[];
  winLoss: WinLossEntry[];
  footnote: string;
}

const W = 1080;
const PAD = 72;
const CONTENT = W - PAD * 2;

const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

const COLORS = {
  bg: '#0b1220',
  bgGlow: '#16223a',
  surface: '#141f36',
  border: '#25324b',
  text: '#f2f5fb',
  muted: '#95a2ba',
  subtle: '#6b7893',
  brand: '#ff6b2c',
  accent: '#14b8a6',
  win: '#22c55e',
  loss: '#ef4444',
  gold: '#f5b301',
  silver: '#a8b3c4',
  bronze: '#cd7f32',
};

const RANK_COLOR = [COLORS.gold, COLORS.silver, COLORS.bronze];

// Tall enough that the winner's avatar, which is drawn upward from the top of
// the tallest bar, still clears the section label above it.
const PODIUM_HEIGHT = 432;
const CHART_HEIGHT = 300;
const ROW_HEIGHT = 64;
const SECTION_GAP = 56;
const LABEL_GAP = 56;

function font(weight: number, size: number): string {
  return `${weight} ${size}px ${FONT}`;
}

/** Round axis values (1000, 1100, ...) instead of whatever the data lands on. */
function niceTicks(min: number, max: number, count: number): number[] {
  if (max - min < 1e-6) return [Math.round(min)];
  const rawStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((c) => c >= rawStep) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-6; v += step) {
    ticks.push(Math.round(v));
  }
  return ticks;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Shortens text with an ellipsis so it never runs past its box. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === 0) return [''];

  const last = lines.length - 1;
  lines[last] = fit(ctx, lines[last]!, maxWidth);
  return lines;
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  name: string,
  color: string,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = font(700, radius * 0.78);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials(name), cx, cy + radius * 0.04);
  ctx.restore();
}

/** The Rally mark, drawn with the same geometry as the SVG logo. */
function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const scale = size / 32;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  ctx.save();
  ctx.beginPath();
  ctx.arc(13, 19, 9, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = COLORS.brand;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.5;
  for (const yy of [14.5, 23.5]) {
    ctx.beginPath();
    ctx.moveTo(2, yy);
    ctx.lineTo(24, yy);
    ctx.stroke();
  }
  for (const xx of [8.5, 17.5]) {
    ctx.beginPath();
    ctx.moveTo(xx, 8);
    ctx.lineTo(xx, 30);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = COLORS.brand;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(13, 19, 9, 0, Math.PI * 2);
  ctx.stroke();

  // Knock the ball's halo out of the net, then draw the ball itself.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(23.5, 8.5, 7.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  ctx.fillStyle = COLORS.accent;
  ctx.beginPath();
  ctx.arc(23.5, 8.5, 5.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function sectionLabel(ctx: CanvasRenderingContext2D, text: string, y: number): void {
  ctx.font = font(700, 24);
  ctx.fillStyle = COLORS.subtle;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text.toUpperCase(), PAD, y);
}

interface Layout {
  height: number;
  titleLines: string[];
  podiumY: number;
  chartY: number;
  winLossY: number;
  footerY: number;
}

function measure(data: ShareCardData): Layout {
  // A throwaway context is enough to measure text before the real canvas
  // exists, since the font stack does not depend on canvas size.
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font(700, 58);
  const titleLines = wrap(probe, data.title, CONTENT, 2);

  let y = PAD + 60 + 40 + titleLines.length * 68 + 56;

  const podiumY = data.podium.length > 0 ? y + LABEL_GAP : y;
  if (data.podium.length > 0) y = podiumY + PODIUM_HEIGHT + SECTION_GAP;

  const hasChart = data.series.some((entry) => entry.points.length > 1);
  const chartY = hasChart ? y + LABEL_GAP : y;
  if (hasChart) {
    const legendRows = Math.ceil(data.series.length / 3);
    y = chartY + CHART_HEIGHT + legendRows * 40 + SECTION_GAP;
  }

  const winLossY = data.winLoss.length > 0 ? y + LABEL_GAP : y;
  if (data.winLoss.length > 0) y = winLossY + data.winLoss.length * ROW_HEIGHT + SECTION_GAP;

  const footerY = y + 20;
  return { height: Math.round(footerY + 80), titleLines, podiumY, chartY, winLossY, footerY };
}

export function renderShareCard(data: ShareCardData): HTMLCanvasElement {
  const layout = measure(data);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D wird nicht unterstuetzt');

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, layout.height);

  const glow = ctx.createRadialGradient(W * 0.85, 0, 0, W * 0.85, 0, W * 0.9);
  glow.addColorStop(0, COLORS.bgGlow);
  glow.addColorStop(1, COLORS.bg);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, layout.height);

  ctx.fillStyle = COLORS.brand;
  ctx.fillRect(0, 0, W, 8);

  drawHeader(ctx, data, layout);
  if (data.podium.length > 0) drawPodium(ctx, data.podium, layout.podiumY);
  if (data.series.some((entry) => entry.points.length > 1)) {
    drawChart(ctx, data.series, layout.chartY);
  }
  if (data.winLoss.length > 0) drawWinLoss(ctx, data.winLoss, layout.winLossY);
  drawFooter(ctx, data, layout);

  return canvas;
}

function drawHeader(ctx: CanvasRenderingContext2D, data: ShareCardData, layout: Layout): void {
  drawLogo(ctx, PAD, PAD, 52);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(700, 34);
  ctx.fillStyle = COLORS.text;
  ctx.fillText('Rally', PAD + 66, PAD + 40);

  let y = PAD + 60 + 66;
  ctx.font = font(700, 58);
  for (const line of layout.titleLines) {
    ctx.fillText(line, PAD, y);
    y += 68;
  }

  ctx.font = font(400, 30);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(fit(ctx, data.subtitle, CONTENT), PAD, y + 8);
}

function drawPodium(ctx: CanvasRenderingContext2D, podium: PodiumEntry[], top: number): void {
  sectionLabel(ctx, 'Podium', top - 18);

  const gap = 28;
  const colW = (CONTENT - gap * 2) / 3;
  const bottom = top + PODIUM_HEIGHT;
  const barHeights = [212, 158, 124];

  // Second place on the left, winner in the middle, third on the right.
  const order: PodiumEntry[] = [];
  for (const rank of [2, 1, 3] as const) {
    const entry = podium.find((item) => item.rank === rank);
    if (entry) order.push(entry);
  }

  order.forEach((entry) => {
    const slot = entry.rank === 2 ? 0 : entry.rank === 1 ? 1 : 2;
    const x = PAD + slot * (colW + gap);
    const cx = x + colW / 2;
    const barH = barHeights[entry.rank - 1]!;
    const barTop = bottom - barH;
    const rankColor = RANK_COLOR[entry.rank - 1]!;

    ctx.fillStyle = COLORS.surface;
    roundRect(ctx, x, barTop, colW, barH, 20);
    ctx.fill();
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = rankColor;
    roundRect(ctx, x, barTop, colW, 8, 4);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(700, entry.rank === 1 ? 76 : 60);
    ctx.fillStyle = rankColor;
    ctx.fillText(`${entry.rank}`, cx, barTop + (entry.rank === 1 ? 104 : 88));

    const eloY = barTop - 24;
    ctx.font = font(600, 30);
    ctx.fillStyle = COLORS.muted;
    const deltaText = entry.delta === 0 ? '' : ` (${entry.delta > 0 ? '+' : ''}${entry.delta})`;
    ctx.fillText(fit(ctx, `${entry.elo}${deltaText}`, colW), cx, eloY);

    const nameY = eloY - 40;
    ctx.font = font(700, 34);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(fit(ctx, entry.name, colW), cx, nameY);

    drawAvatar(ctx, cx, nameY - 40 - 46, 46, entry.name, entry.color);
  });

  ctx.textAlign = 'left';
}

function drawChart(ctx: CanvasRenderingContext2D, series: SeriesEntry[], top: number): void {
  sectionLabel(ctx, 'Elo-Verlauf', top - 18);

  const left = PAD + 70;
  const right = W - PAD;
  const bottom = top + CHART_HEIGHT - 40;
  const innerW = right - left;
  const innerH = bottom - top;

  const values = series.flatMap((entry) => entry.points);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 40) {
    const mid = (max + min) / 2;
    min = mid - 20;
    max = mid + 20;
  }
  const padding = (max - min) * 0.12;
  min -= padding;
  max += padding;

  const longest = Math.max(1, ...series.map((entry) => entry.points.length - 1));
  const xAt = (index: number) => left + (index / longest) * innerW;
  const yAt = (value: number) => bottom - ((value - min) / (max - min)) * innerH;

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = font(500, 22);
  for (const value of niceTicks(min, max, 4)) {
    const y = yAt(value);
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillStyle = COLORS.subtle;
    ctx.fillText(`${value}`, left - 16, y);
  }

  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const entry of series) {
    if (entry.points.length < 2) continue;
    ctx.strokeStyle = entry.color;
    ctx.beginPath();
    entry.points.forEach((value, index) => {
      const x = xAt(index);
      const y = yAt(value);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const lastIndex = entry.points.length - 1;
    ctx.fillStyle = entry.color;
    ctx.beginPath();
    ctx.arc(xAt(lastIndex), yAt(entry.points[lastIndex]!), 7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Legend, three per row.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = font(500, 24);
  const columnW = CONTENT / 3;
  series.forEach((entry, index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    const x = PAD + column * columnW;
    const y = bottom + 60 + row * 40;
    ctx.fillStyle = entry.color;
    roundRect(ctx, x, y - 9, 18, 18, 5);
    ctx.fill();
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(fit(ctx, entry.name, columnW - 44), x + 28, y);
  });
}

function drawWinLoss(ctx: CanvasRenderingContext2D, rows: WinLossEntry[], top: number): void {
  sectionLabel(ctx, 'Siege und Niederlagen', top - 18);

  rows.forEach((row, index) => {
    const y = top + index * ROW_HEIGHT;
    const total = row.wins + row.losses;
    const centerY = y + ROW_HEIGHT / 2 - 6;

    drawAvatar(ctx, PAD + 20, centerY, 20, row.name, row.color);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = font(600, 26);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(fit(ctx, row.name, 220), PAD + 54, centerY);

    const recordText = `${row.wins}:${row.losses}`;
    ctx.font = font(600, 24);
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(recordText, W - PAD, centerY);

    const barX = PAD + 300;
    const barW = W - PAD - 90 - barX;
    const barY = centerY - 9;

    ctx.fillStyle = COLORS.border;
    roundRect(ctx, barX, barY, barW, 18, 9);
    ctx.fill();

    if (total > 0) {
      const winW = Math.max(0, (row.wins / total) * barW);
      ctx.save();
      roundRect(ctx, barX, barY, barW, 18, 9);
      ctx.clip();
      ctx.fillStyle = COLORS.win;
      ctx.fillRect(barX, barY, winW, 18);
      ctx.fillStyle = COLORS.loss;
      ctx.fillRect(barX + winW, barY, barW - winW, 18);
      ctx.restore();
    }
  });

  ctx.textAlign = 'left';
}

function drawFooter(ctx: CanvasRenderingContext2D, data: ShareCardData, layout: Layout): void {
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, layout.footerY);
  ctx.lineTo(W - PAD, layout.footerY);
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  ctx.font = font(600, 24);
  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.subtle;
  ctx.fillText('Rally · Roundnet', PAD, layout.footerY + 44);
  ctx.textAlign = 'right';
  ctx.fillText(fit(ctx, data.footnote, CONTENT - 260), W - PAD, layout.footerY + 44);
  ctx.textAlign = 'left';
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Bild konnte nicht erzeugt werden'));
    }, 'image/png');
  });
}

export const SHARE_PALETTE = SERIES_COLORS;
