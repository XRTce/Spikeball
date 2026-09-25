import { describe, expect, it } from 'vitest';
import { encode } from 'uqr';
import jsQR from 'jsqr';
import { parseJoinInput } from '../src/sync/index';

/**
 * Rasterizes a uqr module grid into an RGBA buffer the way a real camera
 * frame of a printed/displayed code would look: a white quiet zone border
 * around black modules, several pixels per module. jsQR locates finder
 * patterns by walking runs of pixels, so it needs real resolution to lock
 * on - one pixel per module is too small for it to read reliably.
 */
function rasterize(
  modules: readonly (readonly boolean[])[],
  pixelsPerModule: number,
  quietZoneModules: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const size = modules.length;
  const totalModules = size + quietZoneModules * 2;
  const width = totalModules * pixelsPerModule;
  const height = width;
  const data = new Uint8ClampedArray(width * height * 4);

  // Start fully white (RGBA 255,255,255,255 - the quiet zone and every
  // module's background), then paint the dark modules black over it.
  data.fill(255);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!modules[y]?.[x]) continue;
      const px0 = (x + quietZoneModules) * pixelsPerModule;
      const py0 = (y + quietZoneModules) * pixelsPerModule;
      for (let dy = 0; dy < pixelsPerModule; dy++) {
        for (let dx = 0; dx < pixelsPerModule; dx++) {
          const idx = ((py0 + dy) * width + (px0 + dx)) * 4;
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 255;
        }
      }
    }
  }

  return { data, width, height };
}

describe('in-app QR scanning (jsQR over a rasterized uqr code)', () => {
  it('round-trips a share-link QR code and extracts the tournament id via parseJoinInput', () => {
    const tournamentId = 'a1b2c3d4-e5f6-4789-9abc-def012345678';
    const url = `https://rally.app/t/${tournamentId}`;

    // Same encode() call QrCode.tsx makes for the share sheet.
    const qr = encode(url, { border: 0, ecc: 'M' });
    const { data, width, height } = rasterize(qr.data, 8, 4);

    const decoded = jsQR(data, width, height);

    expect(decoded).not.toBeNull();
    expect(decoded!.data).toBe(url);
    expect(parseJoinInput(decoded!.data)).toBe(tournamentId);
  });

  it('round-trips a bare tournament id the same way a manually-typed id would parse', () => {
    const tournamentId = '11111111-2222-4333-8444-555555555555';

    const qr = encode(tournamentId, { border: 0, ecc: 'M' });
    const { data, width, height } = rasterize(qr.data, 8, 4);

    const decoded = jsQR(data, width, height);

    expect(decoded).not.toBeNull();
    expect(decoded!.data).toBe(tournamentId);
    expect(parseJoinInput(decoded!.data)).toBe(tournamentId);
  });

  it('returns null instead of throwing on an image with no QR code in it', () => {
    const blank = new Uint8ClampedArray(64 * 64 * 4).fill(255);

    expect(jsQR(blank, 64, 64)).toBeNull();
  });
});
