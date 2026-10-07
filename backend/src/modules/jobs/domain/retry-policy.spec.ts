import { MAX_DELAY_SECONDS, backoffSeconds, decideFailure, sanitizeError } from './retry-policy';

const mid = () => 0.5; // zero jitter

describe('backoffSeconds', () => {
  it('doubles from 30 seconds and caps at one hour', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 20].map((n) => backoffSeconds(n, mid))).toEqual([
      30, 60, 120, 240, 480, 960, 1920, 3600, 3600, 3600,
    ]);
  });
  it('applies +/-20% jitter and never returns less than a second or more than the cap', () => {
    expect(backoffSeconds(3, () => 0)).toBe(96);
    expect(backoffSeconds(3, () => 1)).toBe(144);
    expect(backoffSeconds(30, () => 1)).toBe(MAX_DELAY_SECONDS);
    expect(backoffSeconds(0, () => 0)).toBeGreaterThanOrEqual(1);
  });
});

describe('decideFailure', () => {
  it('retries until the attempt budget is spent, then dead-letters', () => {
    expect(decideFailure(1, 3, { random: mid })).toEqual({ kind: 'retry', delaySeconds: 30 });
    expect(decideFailure(2, 3, { random: mid })).toEqual({ kind: 'retry', delaySeconds: 60 });
    expect(decideFailure(3, 3)).toEqual({ kind: 'dead' });
    expect(decideFailure(9, 3)).toEqual({ kind: 'dead' });
  });
  it('dead-letters immediately for permanent failures', () => {
    expect(decideFailure(1, 8, { retryable: false })).toEqual({ kind: 'dead' });
  });
});

describe('sanitizeError', () => {
  it('removes keys, bearer tokens, secret fields and long opaque tokens', () => {
    const msg = [
      'request failed:',
      '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----',
      'Authorization: Bearer ya29.a0AfH6SMBx12345678',
      '{"private_key":"abc123","client_secret":"shh"}',
      'token=' + 'A'.repeat(60),
    ].join(' ');
    const out = sanitizeError(new Error(msg));
    expect(out).not.toMatch(/MIIEvQ|ya29|abc123|shh|AAAAAAAA|BEGIN PRIVATE/);
    expect(out).toContain('request failed');
  });
  it('truncates long messages and tolerates non-errors', () => {
    expect(sanitizeError(new Error('x '.repeat(600))).length).toBeLessThanOrEqual(501);
    expect(sanitizeError({ weird: true })).toBe('Unknown error');
    expect(sanitizeError('plain text')).toBe('plain text');
  });
});
