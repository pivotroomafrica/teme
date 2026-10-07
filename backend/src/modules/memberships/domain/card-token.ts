import { createHash, randomBytes } from 'node:crypto';

/**
 * The card token is the opaque value encoded in the QR code / wallet barcode. It carries no personal
 * data: 256 random bits. Only its SHA-256 hash is stored, so a database leak cannot reproduce cards.
 */
export function newCardToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashCardToken(token) };
}

export function hashCardToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Cheap shape check before hitting the database (43 base64url chars for 32 bytes). */
export function looksLikeCardToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
