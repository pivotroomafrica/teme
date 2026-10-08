/**
 * Cross-site request forgery defence for the cookie-authenticated endpoints (/api/bff/*, /api/session/*).
 * Layers: SameSite=Lax cookies, no CORS headers (browsers refuse cross-origin reads), and this check for every
 * state-changing call:
 *   1. a custom header (`X-Requested-With: tc-web`), which a cross-site page cannot add without a CORS
 *      preflight that this app never grants;
 *   2. the Origin header, when sent, must be this app (browsers always send it on cross-origin POSTs);
 *   3. without Origin, the browser's own Fetch Metadata must say the request is same-origin (or user-initiated).
 * Requests that carry none of this evidence (curl, scripts) are refused: these endpoints are for the web app.
 */
export const CSRF_HEADER = "x-requested-with";
export const CSRF_HEADER_VALUE = "tc-web";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type CsrfResult = { ok: true } | { ok: false; reason: string };

export interface CsrfInput {
  method: string;
  headers: Pick<Headers, "get">;
  /** Origins this app is served from (the configured public URL and the request's own origin). */
  allowedOrigins: readonly string[];
}

export function checkCsrf(input: CsrfInput): CsrfResult {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return { ok: true };

  if (input.headers.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    return { ok: false, reason: "missing request marker" };
  }
  const origin = input.headers.get("origin");
  if (origin) {
    return input.allowedOrigins.includes(origin)
      ? { ok: true }
      : { ok: false, reason: "origin not allowed" };
  }
  const site = input.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "none") return { ok: true };
  return { ok: false, reason: "cannot verify the request origin" };
}

/**
 * For the few GET endpoints that change state (sign-out by redirect): refuse when the browser says another
 * site triggered the request. Absent metadata (older browsers, tools) is allowed because the effect is only
 * signing the person out.
 */
export function isCrossSiteNavigation(headers: Pick<Headers, "get">): boolean {
  return headers.get("sec-fetch-site") === "cross-site";
}
