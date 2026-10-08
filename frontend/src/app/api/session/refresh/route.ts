import { NextResponse, type NextRequest } from "next/server";
import { isCrossSiteNavigation } from "@/lib/auth/csrf";
import { safeNextPath } from "@/lib/auth/redirects";
import { needsRefresh } from "@/lib/auth/session-data";
import {
  clearSession,
  commitSession,
  ensureFreshSession,
  noStore,
  sessionFromRequest,
} from "@/lib/auth/session-server";
import { isApiError } from "@/lib/errors/api-error";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";

/**
 * Where an expiring access token is renewed for page loads. Server Components cannot set cookies, so a page
 * that notices a stale token sends the browser here; this handler refreshes (once per session, see
 * lib/auth/refresh.ts), stores the new tokens, and sends the browser straight back to the page.
 *
 *   GET /api/session/refresh?next=/en/dashboard&locale=en
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const localeParam = url.searchParams.get("locale");
  const locale: Locale = isLocale(localeParam) ? localeParam : defaultLocale;
  const back = (path: string) => noStore(NextResponse.redirect(new URL(path, url)));
  const target = safeNextPath(url.searchParams.get("next"), { locale }) ?? `/${locale}`;
  const ended = (reason: string) =>
    clearSession(back(`/${locale}/session-expired?reason=${reason}`));

  if (isCrossSiteNavigation(request.headers)) return back(`/${locale}/login`);

  const session = await sessionFromRequest(request);
  if (!session) return back(`/${locale}/login?next=${encodeURIComponent(target)}`);

  try {
    const { data } = await ensureFreshSession(session);
    // Loop guard: if the backend ever issues a token that is already (nearly) expired, a page would send the
    // browser straight back here. End the session instead of bouncing forever.
    if (needsRefresh(data, Date.now())) return ended("expired");
    return noStore(await commitSession(NextResponse.redirect(new URL(target, url)), data));
  } catch (error) {
    if (isApiError(error) && error.kind === "unauthenticated") return ended("expired");
    // The backend could not be reached: keep the session so a retry can work, and say so.
    return back(`/${locale}/session-expired?reason=unavailable`);
  }
}
