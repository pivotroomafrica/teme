/**
 * Content-Security-Policy for pages. Scripts are allowed only when they carry this request's random nonce (and
 * scripts those load, via 'strict-dynamic'), so injected markup cannot run code even if some text were ever
 * rendered unescaped. Styles from other origins and inline <style> elements need the same nonce; the one allowance
 * is inline style ATTRIBUTES (`style-src-attr`), which the app uses for business brand colours and progress widths
 * and which cannot run code.
 *
 * Everything else is closed: the browser talks only to its own origin (the backend is reached server-side or through
 * the same-origin proxy), nothing may frame the app, and plugins, base-tag and cross-site form targets are refused.
 */
export function buildCsp(options: { nonce: string; production: boolean }): string {
  const { nonce, production } = options;
  return [
    "default-src 'self'",
    // React uses eval in development to rebuild server stack traces in the browser. Never in production.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${production ? "" : " 'unsafe-eval'"}`,
    // The development server injects <style> elements for hot reloading, which cannot carry a nonce. A production
    // build ships its CSS as files only, so there the policy stays strict.
    production ? `style-src 'self' 'nonce-${nonce}'` : "style-src 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self'${production ? "" : " ws: wss:"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(production ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** A fresh, unguessable value for each request (128 bits of randomness, base64). */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** For responses that are never rendered as pages (the JSON API routes): nothing may load or run. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";
