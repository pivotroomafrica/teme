/**
 * Audit metadata must never contain secrets or unnecessary personal data. This is a safety net:
 * callers should still pass only what they need.
 */
const SENSITIVE_KEY =
  /pass(word)?|secret|token|hash|authorization|cookie|credential|private|signature|api[-_]?key|otp|pin$|^phone|e164|^email$/i;

const MAX_STRING = 500;
const MAX_DEPTH = 4;
const MAX_KEYS = 40;

export type AuditMetadata = Record<string, unknown>;

export function sanitizeMetadata(input: unknown, depth = 0): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return input.length > MAX_STRING ? `${input.slice(0, MAX_STRING)}…` : input;
  }
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (input instanceof Date) return input.toISOString();
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(input))
    return input.slice(0, MAX_KEYS).map((v) => sanitizeMetadata(v, depth + 1));
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>).slice(
      0,
      MAX_KEYS,
    )) {
      out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeMetadata(value, depth + 1);
    }
    return out;
  }
  return String(input);
}
