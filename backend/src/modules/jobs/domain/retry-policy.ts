/** Delay before retry number `attempt` (1 = first retry): 30s, 1m, 2m, 4m ... capped at one hour. */
export const BASE_DELAY_SECONDS = 30;
export const MAX_DELAY_SECONDS = 3600;

export function backoffSeconds(attempt: number, random: () => number = Math.random): number {
  const exp = Math.min(MAX_DELAY_SECONDS, BASE_DELAY_SECONDS * 2 ** Math.max(0, attempt - 1));
  // +/-20% jitter so a burst of failures does not retry in lockstep.
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.min(MAX_DELAY_SECONDS, Math.max(1, Math.round(exp * jitter)));
}

export type FailureDecision = { kind: 'retry'; delaySeconds: number } | { kind: 'dead' };

/** `attempts` already includes the attempt that just failed. */
export function decideFailure(
  attempts: number,
  maxAttempts: number,
  options: { retryable?: boolean; random?: () => number } = {},
): FailureDecision {
  if (options.retryable === false || attempts >= maxAttempts) return { kind: 'dead' };
  return { kind: 'retry', delaySeconds: backoffSeconds(attempts, options.random) };
}

const PEM_BLOCK = /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g;
const BEARER = /\b(Bearer|ApplePass|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const SECRET_FIELD =
  /("?(?:private_key|client_secret|access_token|refresh_token|password|passphrase|authorization)"?\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{40,}\b/g;

/**
 * Error text stored with a failed job: enough to diagnose, with anything that looks like a credential
 * removed and the length capped. Provider errors can echo request details, so scrub before persisting.
 */
export function sanitizeError(error: unknown, maxLength = 500): string {
  const raw =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
  const cleaned = raw
    .replace(PEM_BLOCK, '[REDACTED KEY]')
    .replace(BEARER, '$1 [REDACTED]')
    .replace(SECRET_FIELD, '$1[REDACTED]')
    .replace(LONG_TOKEN, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}
