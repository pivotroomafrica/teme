import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerApi } from "@/lib/api/server";
import { checkCsrf } from "@/lib/auth/csrf";
import { homeFor } from "@/lib/auth/permissions";
import { safeNextPath } from "@/lib/auth/redirects";
import { sessionFromLogin } from "@/lib/auth/session-data";
import {
  allowedOrigins,
  commitSession,
  errorResponse,
  noStore,
  plainError,
} from "@/lib/auth/session-server";
import { isApiError } from "@/lib/errors/api-error";
import { defaultLocale, isLocale } from "@/lib/i18n/config";

const bodySchema = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(256),
  next: z.string().max(1024).optional(),
  locale: z.string().optional(),
});

/**
 * Signs a person in. The browser sends the credentials here (same origin); this handler talks to the backend,
 * keeps the tokens in the sealed HttpOnly cookie, and answers with only where to go next. The tokens never
 * reach browser JavaScript, and the password is never logged or echoed.
 */
export async function POST(request: NextRequest) {
  const csrf = checkCsrf({
    method: request.method,
    headers: request.headers,
    allowedOrigins: allowedOrigins(request),
  });
  if (!csrf.ok) return plainError(403, "FORBIDDEN", "Request refused.");

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return plainError(400, "VALIDATION_FAILED", "Request validation failed.");
  }

  try {
    const anonymous = await getServerApi();
    const session = await anonymous.auth.login({
      email: parsed.email,
      password: parsed.password,
      deviceLabel: "web",
    });
    const data = sessionFromLogin(session, Date.now());

    // Permissions decide the landing page; ask the backend rather than trusting the role name.
    const me = await (await getServerApi({ accessToken: session.accessToken })).auth.me();
    const principal = { kind: me.kind, permissions: me.permissions };
    const locale = isLocale(parsed.locale) ? parsed.locale : defaultLocale;
    const next = safeNextPath(parsed.next, { locale, principal });
    const redirectTo = next ?? `/${locale}${homeFor(principal)}`;

    return noStore(
      await commitSession(
        NextResponse.json({
          redirectTo,
          user: { displayName: session.user.displayName, role: session.user.role },
        }),
        data,
      ),
    );
  } catch (error) {
    if (isApiError(error) && error.kind === "unauthenticated") {
      // Same answer whatever the reason: wrong password, unknown account, deactivated, locked.
      return errorResponse(error);
    }
    return errorResponse(error);
  }
}
