import { inflateSync } from 'node:zlib';
import { encodePng, iconPng, stripPng } from './images';

function decode(png: Buffer) {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  // IDAT is the only data chunk we write.
  const idatAt = png.indexOf('IDAT');
  const len = png.readUInt32BE(idatAt - 4);
  const raw = inflateSync(png.subarray(idatAt + 4, idatAt + 4 + len));
  const px = (x: number, y: number) => {
    const i = y * (width * 4 + 1) + 1 + x * 4;
    return [raw[i], raw[i + 1], raw[i + 2], raw[i + 3]];
  };
  return { width, height, px };
}

describe('png generation', () => {
  it('writes a valid PNG with the requested size and pixels', () => {
    const { width, height, px } = decode(encodePng(3, 2, (x, y) => [x * 50, y * 100, 7, 255]));
    expect([width, height]).toEqual([3, 2]);
    expect(px(2, 1)).toEqual([100, 100, 7, 255]);
  });

  it('draws icons in the brand colour', () => {
    const { width, px } = decode(iconPng('#7A4B2A', 58));
    expect(width).toBe(58);
    expect(px(0, 0)).toEqual([122, 75, 42, 255]);
  });

  it('draws the strip at 1x and 2x with collected and empty stamp boxes', () => {
    const state = {
      brandColor: '#7A4B2A',
      currentStamps: 2,
      stampsRequired: 4,
      status: 'ACTIVE' as const,
    };
    const one = decode(stripPng(state, 1));
    const two = decode(stripPng(state, 2));
    expect([one.width, one.height]).toEqual([375, 123]);
    expect([two.width, two.height]).toEqual([750, 246]);
    // Collected boxes are solid foreground, empty ones are translucent.
    const solid = new Set<string>();
    const faint = new Set<string>();
    for (let x = 0; x < one.width; x++) {
      const p = one.px(x, 61) as number[];
      if (p[3] === 255 && p[0] === 255) solid.add('fg');
      if (p[3] === 70) faint.add('dim');
    }
    expect(solid.size).toBe(1);
    expect(faint.size).toBe(1);
  });

  it('switches to a progress bar for long cards and greys out suspended cards', () => {
    const long = decode(
      stripPng({ brandColor: null, currentStamps: 10, stampsRequired: 20, status: 'ACTIVE' }, 1),
    );
    expect(long.width).toBe(375);
    const suspended = decode(
      stripPng(
        { brandColor: '#000000', currentStamps: 3, stampsRequired: 4, status: 'SUSPENDED' },
        1,
      ),
    );
    let collected = 0;
    for (let x = 0; x < suspended.width; x++)
      if (
        (suspended.px(x, 61) as number[])[3] === 255 &&
        (suspended.px(x, 61) as number[])[0] === 255
      )
        collected++;
    expect(collected).toBe(0);
  });
});
