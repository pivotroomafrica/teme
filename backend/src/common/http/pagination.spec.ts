import { decodeCursor, encodeCursor } from './pagination';

describe('cursor codec', () => {
  const at = new Date('2026-03-04T05:06:07.890Z');
  const id = '11111111-2222-4333-8444-555555555555';

  it('round-trips', () => {
    expect(decodeCursor(encodeCursor(at, id))).toEqual({ at, id });
  });

  it('treats garbage as no cursor rather than throwing', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('not-base64-json')).toBeNull();
    expect(decodeCursor(Buffer.from('["nope","x"]').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('{"a":1}').toString('base64url'))).toBeNull();
  });
});
