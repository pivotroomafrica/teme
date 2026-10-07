import { isValidIdempotencyKey, requestFingerprint } from './idempotency';

describe('isValidIdempotencyKey', () => {
  it.each(['2c1b1c3a-8f57-4a9e-9c63-0d4f3a1b2c3d', 'scan_0001:abc', 'a'.repeat(128), 'abcdefgh'])(
    'accepts %s',
    (k) => expect(isValidIdempotencyKey(k)).toBe(true),
  );
  it.each([
    undefined,
    '',
    'short',
    'a'.repeat(129),
    'has space 123',
    'semi;colon1',
    'new\nline123',
    'ключ-ключ-ключ',
  ])('rejects %p', (k) => expect(isValidIdempotencyKey(k)).toBe(false));
});

describe('requestFingerprint', () => {
  it('is deterministic and sensitive to every part and to order', () => {
    expect(requestFingerprint('a', 'b')).toBe(requestFingerprint('a', 'b'));
    expect(requestFingerprint('a', 'b')).not.toBe(requestFingerprint('a', 'c'));
    expect(requestFingerprint('a', 'b')).not.toBe(requestFingerprint('b', 'a'));
  });
  it('does not confuse part boundaries', () => {
    expect(requestFingerprint('ab', 'c')).not.toBe(requestFingerprint('a', 'bc'));
  });
});
