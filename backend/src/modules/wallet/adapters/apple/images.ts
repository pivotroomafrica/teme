import { crc32, deflateSync } from 'node:zlib';
import { isLive, parseColor, readableTextColor, type PassState } from '../../domain/pass-state';

type Rgba = [number, number, number, number];

const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData) >>> 0);
  return Buffer.concat([len, typeAndData, crc]);
};

/** Minimal PNG encoder (8-bit RGBA). Wallet cards are drawn from data, so no image files are stored. */
export function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgba,
): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const withAlpha = (c: [number, number, number], a = 255): Rgba => [c[0], c[1], c[2], a];

/** Square app-style icon: the brand colour with a light rounded-ish inner mark. */
export function iconPng(brandColor: string | null, size: number): Buffer {
  const bg = parseColor(brandColor);
  const fg = readableTextColor(bg);
  const m = Math.floor(size * 0.3);
  return encodePng(size, size, (x, y) =>
    x >= m && x < size - m && y >= m && y < size - m ? withAlpha(fg) : withAlpha(bg),
  );
}

/**
 * The stamp strip: one box per stamp (filled = collected). Cards needing more than 12 stamps show a
 * progress bar instead, which stays legible at any size.
 */
export function stripPng(
  state: Pick<PassState, 'brandColor' | 'currentStamps' | 'stampsRequired' | 'status'>,
  scale: 1 | 2,
): Buffer {
  const w = 375 * scale;
  const h = 123 * scale;
  const bg = parseColor(state.brandColor);
  const fg = readableTextColor(bg);
  const dim: Rgba = [fg[0], fg[1], fg[2], 70];
  const live = isLive(state.status);
  const pad = 16 * scale;

  if (state.stampsRequired > 12) {
    const barH = 22 * scale;
    const top = Math.floor((h - barH) / 2);
    const filled = Math.round(((w - 2 * pad) * state.currentStamps) / state.stampsRequired);
    return encodePng(w, h, (x, y) => {
      const inBar = y >= top && y < top + barH && x >= pad && x < w - pad;
      if (!inBar) return withAlpha(bg);
      return live && x - pad < filled ? withAlpha(fg) : dim;
    });
  }

  const n = Math.max(1, state.stampsRequired);
  const gap = 8 * scale;
  const box = Math.min(48 * scale, Math.floor((w - 2 * pad - gap * (n - 1)) / n));
  const total = n * box + (n - 1) * gap;
  const left = Math.floor((w - total) / 2);
  const top = Math.floor((h - box) / 2);
  return encodePng(w, h, (x, y) => {
    if (y < top || y >= top + box || x < left || x >= left + total) return withAlpha(bg);
    const k = Math.floor((x - left) / (box + gap));
    const within = (x - left) % (box + gap);
    if (within >= box) return withAlpha(bg); // the gap between boxes
    const border = Math.max(2, scale * 2);
    const edge =
      within < border || within >= box - border || y - top < border || y - top >= box - border;
    const collected = live && k < state.currentStamps;
    if (collected) return withAlpha(fg);
    return edge ? withAlpha(fg, 160) : dim;
  });
}
