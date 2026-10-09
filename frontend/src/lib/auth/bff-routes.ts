/**
 * Which backend paths the same-origin proxy (/api/bff/*) may forward. Everything else is refused, so a
 * mistake in a page can never turn the proxy into a way to reach the backend's other endpoints, and the
 * browser cannot use it to log in, refresh tokens or reach internal routes by itself.
 *
 *  - public:  needs no session (customer join and card flows)
 *  - private: needs a session; the backend still authorizes each call
 */
export type BffRoute = { path: string; access: "public" | "private" };

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

interface Rule {
  method: string;
  /** Segments; "*" matches exactly one safe segment, "**" matches one or more. */
  pattern: string[];
  access: "public" | "private";
}

const rule = (method: string, pattern: string, access: Rule["access"]): Rule => ({
  method,
  pattern: pattern.split("/").filter(Boolean),
  access,
});

const RULES: Rule[] = [
  // Customer flows: no session, the card token in the body is the credential.
  rule("GET", "join/*", "public"),
  rule("POST", "join/*/enroll", "public"),
  rule("POST", "card/web", "public"),
  rule("POST", "card/wallet/links", "public"),
  rule("POST", "card/consent/marketing/withdraw", "public"),
  // A new team member sets a password with the one-time code they were given. No session exists yet.
  rule("POST", "auth/invitations/accept", "public"),

  // Signed-in areas. (Sign-in, refresh and sign-out have their own handlers and are NOT proxied.)
  rule("GET", "auth/me", "private"),
  ...["GET", "POST", "PUT", "PATCH", "DELETE"].flatMap((method) => [
    rule(method, "scanner/**", "private"),
    rule(method, "merchant/**", "private"),
    rule(method, "platform/**", "private"),
  ]),
];

function matches(pattern: string[], segments: string[]): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    if (p === "**") return segments.length > i;
    if (segments[i] === undefined) return false;
    if (p !== "*" && p !== segments[i]) return false;
  }
  return segments.length === pattern.length;
}

/** Validates the path segments and finds the rule for them, or null when the call must be refused. */
export function resolveBffRoute(method: string, rawSegments: readonly string[]): BffRoute | null {
  if (rawSegments.length === 0 || rawSegments.length > 8) return null;
  const segments: string[] = [];
  for (const raw of rawSegments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return null;
    }
    // After decoding, a segment must still be a plain token: no slashes, dots-only, traversal or whitespace.
    if (decoded !== raw || !SEGMENT.test(decoded) || /^\.+$/.test(decoded)) return null;
    segments.push(decoded);
  }
  const found = RULES.find(
    (r) => r.method === method.toUpperCase() && matches(r.pattern, segments),
  );
  return found ? { path: `/${segments.join("/")}`, access: found.access } : null;
}
