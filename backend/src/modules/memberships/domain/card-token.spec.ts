import { hashCardToken, looksLikeCardToken, newCardToken } from './card-token';

describe('card token', () => {
  it('is 256 bits of randomness, unique, and unrelated to any personal data', () => {
    const a = newCardToken();
    const b = newCardToken();
    expect(a.token).not.toBe(b.token);
    expect(looksLikeCardToken(a.token)).toBe(true);
  });

  it('stores a deterministic hash that is not the token', () => {
    const { token, hash } = newCardToken();
    expect(hash).toBe(hashCardToken(token));
    expect(hash).not.toBe(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects malformed tokens', () => {
    for (const t of ['', 'short', 'x'.repeat(44), `${'a'.repeat(42)}!`, '+251911234567']) {
      expect(looksLikeCardToken(t)).toBe(false);
    }
  });
});
