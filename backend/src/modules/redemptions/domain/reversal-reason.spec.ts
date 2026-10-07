import { cleanReason } from './reversal-reason';

describe('cleanReason', () => {
  it('accepts and tidies a real reason', () => {
    expect(cleanReason('  Scanned   the wrong\tcard  ')).toEqual({
      ok: true,
      reason: 'Scanned the wrong card',
    });
    expect(cleanReason('ስህተት ነበር')).toEqual({ ok: true, reason: 'ስህተት ነበር' });
  });
  it.each([undefined, null, 5, '', '  ', 'ab', ' a\n\t '])('rejects %p', (raw) => {
    expect(cleanReason(raw).ok).toBe(false);
  });
  it('rejects overlong text', () => {
    expect(cleanReason('x'.repeat(501)).ok).toBe(false);
    expect(cleanReason('x'.repeat(500)).ok).toBe(true);
  });
  it('strips control characters', () => {
    expect(cleanReason('line1\u0000\u0007line2')).toEqual({ ok: true, reason: 'line1 line2' });
  });
});
