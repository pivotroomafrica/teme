import { NextResponse, type NextRequest } from "next/server";
import { getServerApi } from "@/lib/api/server";
import { checkCsrf } from "@/lib/auth/csrf";
import {
  allowedOrigins,
  clearSession,
  ensureFreshSession,
  errorResponse,
  noStore,
  plainError,
  sessionFromRequest,
} from "@/lib/auth/session-server";
import { isApiError } from "@/lib/errors/api-error";

/**
 * "Log out of all devices": the backend revokes every session of this account. Unlike a plain sign-out this
 * must succeed on the backend, so a failure is reported instead of silently ignored.
 */
export async function POST(request: NextRequest) {
  const csrf = checkCsrf({
    method: request.method,
    headers: request.headers,
    allowedOrigins: allowedOrigins(request),
  });
  if (!csrf.ok) return plainError(403, "FORBIDDEN", "Request refused.");

  const session = await sessionFromRequest(request);
  if (!session) return clearSession(plainError(401, "UNAUTHENTICATED", "Authentication required."));

  try {
    const { data } = await ensureFreshSession(session);
    await (await getServerApi({ accessToken: data.accessToken })).auth.logoutAllDevices();
    return noStore(clearSession(new NextResponse(null, { status: 204 })));
  } catch (error) {
    const response = errorResponse(error);
    return isApiError(error) && error.kind === "unauthenticated"
      ? clearSession(response)
      : response;
  }
}
