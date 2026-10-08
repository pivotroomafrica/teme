import { NextResponse, type NextRequest } from "next/server";
import { isCrossSiteNavigation } from "@/lib/auth/csrf";
import { clearSession, noStore } from "@/lib/auth/session-server";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";

const REASONS = new Set(["expired", "revoked", "deactivated", "signed-out"]);

/**
 * Removes the session cookie and shows why. Pages use it when the backend says the account or session is no
 * longer valid (a Server Component cannot clear a cookie itself). The only effect is signing the person out,
 * so a request that another website triggered is simply sent to the sign-in page instead.
 *
 *   GET /api/session/end?reason=revoked&locale=am
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const localeParam = url.searchParams.get("locale");
  const locale: Locale = isLocale(localeParam) ? localeParam : defaultLocale;
  if (isCrossSiteNavigation(request.headers)) {
    return noStore(NextResponse.redirect(new URL(`/${locale}/login`, url)));
  }
  const reasonParam = url.searchParams.get("reason") ?? "expired";
  const reason = REASONS.has(reasonParam) ? reasonParam : "expired";
  return noStore(
    clearSession(
      NextResponse.redirect(new URL(`/${locale}/session-expired?reason=${reason}`, url)),
    ),
  );
}
