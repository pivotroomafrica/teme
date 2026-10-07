import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Credentials that wallet passes carry. Everything is DERIVED with HMAC-SHA256 from one server secret,
 * so passes can be regenerated and verified at any time without storing the secret values. Each use
 * has its own domain prefix so a value from one purpose can never be replayed for another.
 */
const derive = (secret: string, purpose: string, ...parts: Array<string | number>): string =>
  createHmac('sha256', secret)
    .update([purpose, ...parts].join('\u0000'))
    .digest('base64url');

/**
 * The opaque value in a wallet pass's QR code. 43 URL-safe characters, indistinguishable in shape from a
 * card token, so the scanner treats it the same way. Increment `version` to revoke it.
 */
export const deriveBarcode = (secret: string, passId: string, version: number): string =>
  derive(secret, 'wallet-barcode/v1', passId, version);

export const hashBarcode = (barcode: string): string =>
  createHash('sha256').update(barcode).digest('hex');

/** Apple's per-pass authenticationToken (sent back by the device as "ApplePass <token>"). */
export const deriveAppleAuthToken = (secret: string, passId: string): string =>
  derive(secret, 'apple-auth/v1', passId);

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Short-lived, tamper-proof token for a pass download link: `exp.mac`. It authorises ONE pass for a few
 * minutes, so the link can be opened by the phone's browser without any login.
 */
export function signLinkToken(secret: string, passId: string, expiresAt: Date): string {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  return `${exp}.${derive(secret, 'wallet-link/v1', passId, exp)}`;
}

export function verifyLinkToken(secret: string, passId: string, token: string, now: Date): boolean {
  const [expRaw, mac] = token.split('.');
  const exp = Number(expRaw);
  if (!mac || !Number.isInteger(exp) || exp * 1000 <= now.getTime()) return false;
  return safeEqual(mac, derive(secret, 'wallet-link/v1', passId, exp));
}
