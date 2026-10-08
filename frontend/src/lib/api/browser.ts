import { createHttpTransport, type Transport } from "./http";
import { createApi, type Api } from "./index";

/** Dispatched on `window` when any browser request is answered with 401, so the session layer can react once. */
export const UNAUTHORIZED_EVENT = "tc:unauthorized";

/** Same-origin proxy that holds the session cookie and adds the bearer token server-side (auth step). */
export const BROWSER_API_BASE = "/api/bff";

/**
 * Transport for Client Components. The browser never talks to the backend directly and never sees a token:
 * it calls this app's own `/api/bff/*` route handlers, which attach credentials from the sealed HttpOnly
 * cookie. `X-Requested-With` lets those handlers reject cross-site form posts (CSRF defence in depth, on top
 * of SameSite=Strict cookies and the Origin check).
 */
export function createBrowserTransport(): Transport {
  return createHttpTransport({
    baseUrl: BROWSER_API_BASE,
    timeoutMs: 15_000,
    credentials: "same-origin",
    defaultHeaders: { "X-Requested-With": "tc-web" },
    onUnauthorized: () => {
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    },
  });
}

let shared: Api | undefined;

/** One API instance per browser tab. */
export function getBrowserApi(): Api {
  shared ??= createApi(createBrowserTransport());
  return shared;
}
