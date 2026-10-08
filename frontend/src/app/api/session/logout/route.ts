import { NextResponse, type NextRequest } from "next/server";
import { getServerApi } from "@/lib/api/server";
import { checkCsrf } from "@/lib/auth/csrf";
import {
  allowedOrigins,
  clearSession,
  noStore,
  plainError,
  sessionFromRequest,
} from "@/lib/auth/session-server";

/**
 * Ends this browser's session: tells the backend to revoke the refresh token (best effort, so signing out
 * always works even if the backend is unreachable) and removes the cookie.
 */
export async function POST(request: NextRequest) {
  const csrf = checkCsrf({
    method: request.method,
    headers: request.headers,
    allowedOrigins: allowedOrigins(request),
  });
  if (!csrf.ok) return plainError(403, "FORBIDDEN", "Request refused.");

  const session = await sessionFromRequest(request);
  if (session) {
    try {
      await (await getServerApi()).auth.logout(session.refreshToken);
    } catch {
      // The cookie is removed regardless; the refresh token will expire on its own.
    }
  }
  return noStore(clearSession(new NextResponse(null, { status: 204 })));
}
