import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerApi } from "@/lib/api/server";
import { BRANCH_COOKIE, branchCookieOptions } from "@/lib/auth/branch";
import { checkCsrf } from "@/lib/auth/csrf";
import {
  allowedOrigins,
  clearSession,
  commitSession,
  ensureFreshSession,
  errorResponse,
  noStore,
  plainError,
  sessionFromRequest,
} from "@/lib/auth/session-server";
import { getServerEnv } from "@/lib/config/server-env";
import { isApiError } from "@/lib/errors/api-error";

const bodySchema = z.object({ branchId: z.string().uuid() });

/**
 * Remembers which branch a staff member is working at. The choice is checked against the branches the
 * backend lists for THIS account (never trusted from the browser) and kept in an HttpOnly cookie.
 */
export async function POST(request: NextRequest) {
  const csrf = checkCsrf({
    method: request.method,
    headers: request.headers,
    allowedOrigins: allowedOrigins(request),
  });
  if (!csrf.ok) return plainError(403, "FORBIDDEN", "Request refused.");

  const session = await sessionFromRequest(request);
  if (!session) return plainError(401, "UNAUTHENTICATED", "Authentication required.");

  let branchId: string;
  try {
    branchId = bodySchema.parse(await request.json()).branchId;
  } catch {
    return plainError(400, "VALIDATION_FAILED", "Request validation failed.");
  }

  try {
    const { data, refreshed } = await ensureFreshSession(session);
    const branches = await (await getServerApi({ accessToken: data.accessToken })).branches.list();
    if (!branches.some((b) => b.id === branchId && b.status === "ACTIVE")) {
      // Same answer for "does not exist" and "not yours".
      return plainError(404, "NOT_FOUND", "Branch not found.");
    }
    const response = noStore(new NextResponse(null, { status: 204 }));
    response.cookies.set(
      BRANCH_COOKIE,
      branchId,
      branchCookieOptions(getServerEnv().NODE_ENV === "production"),
    );
    return refreshed ? await commitSession(response, data) : response;
  } catch (error) {
    const response = errorResponse(error);
    return isApiError(error) && error.kind === "unauthenticated"
      ? clearSession(response)
      : response;
  }
}
