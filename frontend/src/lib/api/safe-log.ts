/**
 * Logging for API traffic that cannot leak. Only a fixed set of non-sensitive facts is ever logged
 * (method, path template without query, status, duration, request id, error kind/code). Bodies, headers,
 * tokens and phone numbers are never passed in, and `redact` is available for any ad-hoc object.
 */
const SENSITIVE_KEY =
  /^(authorization|cookie|set-cookie|password|currentpassword|newpassword|accesstoken|refreshtoken|token|cardtoken|barcode|phone|phonee164|firstname|idempotency-key|secret|session)$/i;

export function redact<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(inner, depth + 1);
  }
  return out as T;
}

export interface ApiLogEvent {
  method: string;
  /** Path as requested, WITHOUT the query string. */
  path: string;
  status?: number;
  durationMs: number;
  requestId: string;
  errorKind?: string;
  errorCode?: string;
  attempt?: number;
}

export type ApiLogger = (event: ApiLogEvent) => void;

/** Path without query or fragment: query strings can carry search terms such as names or phone numbers. */
export const pathOnly = (path: string): string => path.split(/[?#]/, 1)[0] ?? path;

/** Logs failures only (quiet in normal operation) as one JSON line, safe for server log collectors. */
export const consoleApiLogger: ApiLogger = (event) => {
  if (!event.errorKind) return;
  console.warn(JSON.stringify({ msg: "api request failed", ...event, path: pathOnly(event.path) }));
};
