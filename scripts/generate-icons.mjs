#!/usr/bin/env node
/**
 * Renders the Rally mark into the PNG icons the web app manifest needs.
 *
 * The logo is nothing but circles and straight lines, so it is rasterised here
 * from signed distance fields and written out with Node's own zlib. That keeps
 * the toolchain free of a native image dependency, and the output is
 * byte-identical on every machine - re-run `npm run icons` after changing the
 * geometry below and commit the result.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'icons');

const INK = [0x0b, 0x12, 0x20];
const BRAND = [0xff, 0x6b, 0x2c];
const ACCENT = [0x14, 0xb8, 0xa6];

/* ---- Geometry, in the same 32x32 space as the SVG logo ------------------ */
const NET = { cx: 13, cy: 19, r: 9, stroke: 3 };
const BALL = { cx: 23.5, cy: 8.5, r: 5.4, halo: 7.8 };
const NET_LINES_H = [14.5, 23.5];
const NET_LINES_V = [8.5, 17.5];
const MESH_STROKE = 1.5;

/* ---- Distance helpers --------------------------------------------------- */
const length = (x, y) => Math.hypot(x, y);

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return length(px - (ax + t * dx), py - (ay + t * dy));
}

/** Antialiased coverage from a signed distance, negative meaning inside. */
function coverage(distance, pixel) {
  return Math.max(0, Math.min(1, 0.5 - distance / pixel));
}

function overlay(dst, index, colour, alpha) {
  if (alpha <= 0) return;
  const inverse = 1 - alpha;
  dst[index] = colour[0] * alpha + dst[index] * inverse;
  dst[index + 1] = colour[1] * alpha + dst[index + 1] * inverse;
  dst[index + 2] = colour[2] * alpha + dst[index + 2] * inverse;
  dst[index + 3] = 255 * alpha + dst[index + 3] * inverse;
}

/**
 * @param {number} size    output edge length in px
 * @param {number} scale   fraction of the canvas the 32x32 artwork fills
 * @param {number[]|null} background  RGB fill, or null for transparency
 * @param {number} cornerRadius  rounded-square radius as a fraction of size
 */
function renderIcon(size, { scale = 0.72, background = INK, cornerRadius = 0.22 } = {}) {
  const pixels = new Float64Array(size * size * 4);
  const unit = (size * scale) / 32; // px per design unit
  const pixelInUnits = 1 / unit;
  const offsetX = (size - 32 * unit) / 2;
  const offsetY = (size - 32 * unit) / 2;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const index = (py * size + px) * 4;
      // Pixel centre, expressed in the 32x32 design space.
      const x = (px + 0.5 - offsetX) / unit;
      const y = (py + 0.5 - offsetY) / unit;

      if (background) {
        const alpha = cornerRadius > 0
          ? roundedSquareCoverage(px + 0.5, py + 0.5, size, cornerRadius * size)
          : 1;
        overlay(pixels, index, background, alpha);
      }

      const haloCoverage = coverage(length(x - BALL.cx, y - BALL.cy) - BALL.halo, pixelInUnits);
      const keep = 1 - haloCoverage;

      if (keep > 0) {
        let meshCoverage = 0;
        for (const lineY of NET_LINES_H) {
          meshCoverage = Math.max(
            meshCoverage,
            coverage(distanceToSegment(x, y, 2, lineY, 24, lineY) - MESH_STROKE / 2, pixelInUnits),
          );
        }
        for (const lineX of NET_LINES_V) {
          meshCoverage = Math.max(
            meshCoverage,
            coverage(distanceToSegment(x, y, lineX, 8, lineX, 30) - MESH_STROKE / 2, pixelInUnits),
          );
        }
        // The mesh only exists inside the net.
        const insideNet = coverage(length(x - NET.cx, y - NET.cy) - NET.r, pixelInUnits);
        overlay(pixels, index, BRAND, meshCoverage * insideNet * keep * 0.5);

        const ring = coverage(
          Math.abs(length(x - NET.cx, y - NET.cy) - NET.r) - NET.stroke / 2,
          pixelInUnits,
        );
        overlay(pixels, index, BRAND, ring * keep);
      }

      overlay(pixels, index, ACCENT, coverage(length(x - BALL.cx, y - BALL.cy) - BALL.r, pixelInUnits));
    }
  }

  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < pixels.length; i += 1) out[i] = Math.round(Math.max(0, Math.min(255, pixels[i])));
  return out;
}

function roundedSquareCoverage(px, py, size, radius) {
  const half = size / 2;
  const dx = Math.abs(px - half) - (half - radius);
  const dy = Math.abs(py - half) - (half - radius);
  const outside = length(Math.max(dx, 0), Math.max(dy, 0));
  const distance = outside + Math.min(Math.max(dx, dy), 0) - radius;
  return Math.max(0, Math.min(1, 0.5 - distance));
}

/* ---- Minimal PNG writer -------------------------------------------------- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(rgba, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  // Filter type 0 (none) in front of every scanline.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---- SVG sources --------------------------------------------------------- */
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <defs>
    <mask id="k">
      <rect width="32" height="32" fill="#fff"/>
      <circle cx="23.5" cy="8.5" r="7.8" fill="#000"/>
    </mask>
    <clipPath id="c"><circle cx="13" cy="19" r="9"/></clipPath>
  </defs>
  <rect width="32" height="32" rx="7" fill="#0b1220"/>
  <g mask="url(#k)">
    <g clip-path="url(#c)" stroke="#ff6b2c" stroke-width="1.5" opacity=".5">
      <path d="M2 14.5h22M2 23.5h22M8.5 8v22M17.5 8v22"/>
    </g>
    <circle cx="13" cy="19" r="9" fill="none" stroke="#ff6b2c" stroke-width="3"/>
  </g>
  <circle cx="23.5" cy="8.5" r="5.4" fill="#14b8a6"/>
</svg>
`;

const logoMark = favicon.replace('<rect width="32" height="32" rx="7" fill="#0b1220"/>\n  ', '');

/* ---- Write everything ---------------------------------------------------- */
mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, options: {} },
  { file: 'icon-512.png', size: 512, options: {} },
  // Maskable icons are cropped to a circle by the launcher, so the artwork
  // stays inside the inner 80% safe zone and the background bleeds to the edge.
  { file: 'maskable-192.png', size: 192, options: { scale: 0.56, cornerRadius: 0 } },
  { file: 'maskable-512.png', size: 512, options: { scale: 0.56, cornerRadius: 0 } },
  { file: 'apple-touch-icon.png', size: 180, options: { scale: 0.68, cornerRadius: 0 } },
];

for (const { file, size, options } of targets) {
  writeFileSync(join(OUT_DIR, file), encodePng(renderIcon(size, options), size));
  console.log(`wrote icons/${file} (${size}x${size})`);
}

writeFileSync(join(ROOT, 'public', 'favicon.svg'), favicon);
writeFileSync(join(ROOT, 'public', 'logo.svg'), logoMark);
console.log('wrote favicon.svg and logo.svg');
