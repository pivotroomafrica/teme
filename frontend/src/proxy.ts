import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER } from "@/lib/auth/constants";
import { AREA_ACCOUNT_KIND, areaOf } from "@/lib/auth/permissions";
import { SESSION_COOKIE, openSession } from "@/lib/auth/session-data";
import { getServerEnv } from "@/lib/config/server-env";
import { LOCALE_COOKIE } from "@/lib/i18n/config";
import { resolveLocale, splitLocale } from "@/lib/i18n/resolve-locale";
import { buildCsp, newNonce } from "@/lib/security/csp";

/** Areas that must never appear in a search engine: they are private, per-user or per-card pages. */
const PRIVATE_AREAS = [
  "/login",
  "/accept-invitation",
  "/denied",
  "/session-expired",
  "/card",
  "/wallet",
  "/staff",
  "/dashboard",
  "/operations",
  "/dev",
];

const isPrivate = (rest: string) =>
  PRIVATE_AREAS.some((area) => rest === area || rest.startsWith(`${area}/`));

/**
 * Runs before every page request (Next.js 16 "proxy", formerly middleware). It does only cheap, optimistic work:
 *  - language routing and indexing headers;
 *  - telling pages which path was requested (for "come back here after sign-in");
 *  - for signed-in areas: no valid session cookie, or an account of the wrong kind, is turned away early.
 * It never refreshes tokens and never decides permissions. The layouts and pages check with the backend
 * (lib/auth/server.ts), and the backend checks again on every API call.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { locale, rest } = splitLocale(pathname);

  if (!locale) {
    const chosen = resolveLocale({
      cookie: request.cookies.get(LOCALE_COOKIE)?.value,
      acceptLanguage: request.headers.get("accept-language"),
    });
    const url = request.nextUrl.clone();
    url.pathname = `/${chosen}${pathname === "/" ? "" : pathname}`;
    url.search = search;
    return NextResponse.redirect(url);
  }

  const area = areaOf(rest);
  if (area) {
    const env = getServerEnv();
    const session = await openSession(
      request.cookies.get(SESSION_COOKIE)?.value,
      env.TC_SESSION_SECRET,
      { now: Date.now(), maxAgeDays: env.TC_SESSION_MAX_AGE_DAYS },
    );
    if (!session) {
      const url = request.nextUrl.clone();
      url.pathname = `/${locale}/login`;
      url.search = `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(url);
    }
    if (AREA_ACCOUNT_KIND[area] !== session.user.kind) {
      const url = request.nextUrl.clone();
      url.pathname = `/${locale}/denied`;
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  // Pages read this to build links back to the current page. Set here, it replaces anything the client sent.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATH_HEADER, pathname + search);
  // A fresh nonce per request. Next.js reads it from the request's policy and stamps it on its own scripts, so
  // nothing else (injected markup, a stray inline script) can run. The same policy is sent to the browser.
  const csp = buildCsp({ nonce: newNonce(), production: process.env.NODE_ENV === "production" });
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  // Remember the last language the visitor actually used. A preference only: it carries no identity.
  if (request.cookies.get(LOCALE_COOKIE)?.value !== locale) {
    response.cookies.set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  if (isPrivate(rest)) response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

export const config = {
  // Skip API routes, Next.js internals and anything that looks like a file (has an extension).
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
