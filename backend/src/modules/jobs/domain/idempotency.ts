import { createHash } from 'node:crypto';

/** 8-128 characters from a URL-safe alphabet (UUIDs fit). Keeps keys loggable and index-friendly. */
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

export function isValidIdempotencyKey(key: string | undefined): key is string {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

/**
 * Fingerprint of the logical request. Re-using a key with a different request is a client bug
 * (or an attack) and must not silently return an unrelated stored answer.
 */
export function requestFingerprint(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}
