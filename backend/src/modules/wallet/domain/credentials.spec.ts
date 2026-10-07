import { looksLikeCardToken } from '../../memberships';
import {
  deriveAppleAuthToken,
  deriveBarcode,
  hashBarcode,
  safeEqual,
  signLinkToken,
  verifyLinkToken,
} from './credentials';

const secret = 'unit-test-secret-unit-test-secret-1234';
const passId = '11111111-2222-4333-8444-555555555555';

describe('derived credentials', () => {
  it('derives a stable, scanner-compatible barcode per pass and version', () => {
    const a = deriveBarcode(secret, passId, 1);
    expect(deriveBarcode(secret, passId, 1)).toBe(a);
    expect(looksLikeCardToken(a)).toBe(true);
    expect(deriveBarcode(secret, passId, 2)).not.toBe(a); // revoking = bumping the version
    expect(deriveBarcode(secret, '99999999-2222-4333-8444-555555555555', 1)).not.toBe(a);
    expect(deriveBarcode('another-secret-another-secret-12345', passId, 1)).not.toBe(a);
  });

  it('never reveals the pass id or secret in the barcode, and stores only a hash', () => {
    const barcode = deriveBarcode(secret, passId, 1);
    expect(barcode).not.toContain(passId.slice(0, 8));
    expect(hashBarcode(barcode)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBarcode(barcode)).not.toBe(barcode);
  });

  it('keeps purposes apart: an Apple auth token is not a barcode', () => {
    expect(deriveAppleAuthToken(secret, passId)).not.toBe(deriveBarcode(secret, passId, 1));
    expect(deriveAppleAuthToken(secret, passId).length).toBeGreaterThanOrEqual(16);
  });

  it('compares in constant time and handles different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('download link tokens', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const later = new Date(now.getTime() + 10 * 60_000);

  it('accepts a fresh token for its own pass', () => {
    const t = signLinkToken(secret, passId, later);
    expect(verifyLinkToken(secret, passId, t, now)).toBe(true);
  });

  it('rejects expired, foreign-pass, tampered and malformed tokens', () => {
    const t = signLinkToken(secret, passId, later);
    expect(verifyLinkToken(secret, passId, t, new Date(later.getTime() + 1000))).toBe(false);
    expect(verifyLinkToken(secret, '99999999-2222-4333-8444-555555555555', t, now)).toBe(false);
    const [exp, mac] = t.split('.');
    expect(verifyLinkToken(secret, passId, `${Number(exp) + 3600}.${mac}`, now)).toBe(false);
    expect(verifyLinkToken(secret, passId, `${exp}.${mac}x`, now)).toBe(false);
    expect(verifyLinkToken(secret, passId, 'garbage', now)).toBe(false);
    expect(verifyLinkToken(secret, passId, '', now)).toBe(false);
    expect(verifyLinkToken('wrong-secret-wrong-secret-1234567890', passId, t, now)).toBe(false);
  });
});
