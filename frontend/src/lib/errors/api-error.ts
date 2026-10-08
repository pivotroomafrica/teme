/**
 * One error type for everything that can go wrong talking to the backend. The UI never inspects raw
 * responses: it switches on `kind` (and sometimes `code`) and shows `fieldErrors` next to inputs.
 *
 * The backend always answers failures with
 *   { "error": { "code", "message", "details"?, "requestId", "timestamp" } }
 * (see backend/docs/frontend-contract.md). Anything else (HTML from a proxy, an empty body) is still turned
 * into a sensible ApiError here.
 */
export type ApiErrorKind =
  | "validation" // 400: the request body or query was rejected; see fieldErrors
  | "unauthenticated" // 401: no valid session
  | "forbidden" // 403: signed in, not allowed
  | "not_found" // 404 (also "not yours")
  | "conflict" // 409: a business rule (e.g. already redeemed)
  | "unprocessable" // 422: e.g. idempotency key reused for a different request
  | "rate_limited" // 429
  | "payload_too_large" // 413
  | "unavailable" // 502/503/504: upstream or maintenance
  | "server" // other 5xx
  | "network" // the request never completed
  | "timeout" // our deadline passed
  | "aborted" // the caller cancelled
  | "malformed" // a success response that is not what the contract promises
  | "unknown";

export interface ApiErrorInit {
  kind: ApiErrorKind;
  status?: number;
  /** Stable machine code from the backend (e.g. COOLDOWN_ACTIVE) or a client-side code (e.g. NETWORK_ERROR). */
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
  fieldErrors?: Record<string, string>;
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly details: unknown;
  readonly fieldErrors: Record<string, string>;
  readonly retryAfterSeconds: number | undefined;

  constructor(init: ApiErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ApiError";
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.details = init.details;
    this.fieldErrors = init.fieldErrors ?? {};
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  /** The session is gone or invalid: sign the user out / refresh. */
  get isAuthError(): boolean {
    return this.kind === "unauthenticated";
  }

  /** Transient problems where trying the same safe request again may work. */
  get isTransient(): boolean {
    return this.kind === "network" || this.kind === "timeout" || this.kind === "unavailable";
  }
}

export const isApiError = (value: unknown): value is ApiError => value instanceof ApiError;

export function kindForStatus(status: number): ApiErrorKind {
  switch (status) {
    case 400:
      return "validation";
    case 401:
      return "unauthenticated";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 413:
      return "payload_too_large";
    case 422:
      return "unprocessable";
    case 429:
      return "rate_limited";
    case 502:
    case 503:
    case 504:
      return "unavailable";
    default:
      return status >= 500 ? "server" : "unknown";
  }
}

/**
 * Maps class-validator style messages ("firstName should not be empty", "program.reward.nameEn must be a
 * string") to { field: message }. The first message per field wins. Messages that do not start with a
 * property path are ignored (they are shown as a general error instead).
 */
export function mapFieldErrors(details: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(details)) return out;
  for (const entry of details) {
    if (typeof entry !== "string") continue;
    const match = /^([A-Za-z_$][\w$]*(?:\.[\w$]+|\[\d+\])*)\s+(\S.*)$/.exec(entry.trim());
    if (!match) continue;
    const [, field, message] = match as unknown as [string, string, string];
    if (!(field in out)) out[field] = message;
  }
  return out;
}

interface Envelope {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  requestId?: unknown;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Builds an ApiError from an HTTP failure. `body` is whatever JSON was parsed (or undefined). */
export function apiErrorFromResponse(input: {
  status: number;
  body: unknown;
  retryAfterHeader?: string | null;
  requestIdHeader?: string | null;
}): ApiError {
  const envelope: Envelope =
    typeof input.body === "object" && input.body !== null && "error" in input.body
      ? ((input.body as { error: Envelope }).error ?? {})
      : {};
  const kind = kindForStatus(input.status);
  const retryAfter = input.retryAfterHeader ? Number.parseInt(input.retryAfterHeader, 10) : NaN;
  return new ApiError({
    kind,
    status: input.status,
    code: str(envelope.code) ?? `HTTP_${input.status}`,
    message: str(envelope.message) ?? `Request failed with status ${input.status}`,
    requestId: str(envelope.requestId) ?? str(input.requestIdHeader),
    details: envelope.details,
    fieldErrors: kind === "validation" ? mapFieldErrors(envelope.details) : {},
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : undefined,
  });
}

/** Anything thrown becomes an ApiError, so callers handle exactly one shape. */
export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new ApiError({
      kind: "aborted",
      code: "ABORTED",
      message: "The request was cancelled.",
      cause: error,
    });
  }
  return new ApiError({
    kind: "unknown",
    code: "UNEXPECTED",
    message: error instanceof Error ? error.message : "Unexpected error",
    cause: error,
  });
}
