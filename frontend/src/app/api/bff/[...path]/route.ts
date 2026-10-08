import { NextResponse, type NextRequest } from "next/server";
import { createServerTransport } from "@/lib/api/server";
import { isValidIdempotencyKey } from "@/lib/api/idempotency";
import type { Query } from "@/lib/api/query";
import type { HttpMethod } from "@/lib/api/http";
import { resolveBffRoute } from "@/lib/auth/bff-routes";
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
import { isApiError } from "@/lib/errors/api-error";

/**
 * The browser's only way to the backend. Client Components call `/api/bff/<backend path>`; this handler:
 *  1. refuses anything that is not on the allow-list (lib/auth/bff-routes.ts);
 *  2. refuses cross-site state-changing requests (lib/auth/csrf.ts);
 *  3. for private routes, reads the sealed session cookie, refreshes the access token if needed, and adds
 *     the bearer token itself, so browser JavaScript never holds a token;
 *  4. sends the request ONCE (no retry of state-changing calls) and relays the status and JSON body;
 *  5. never forwards cookies, tokens or backend headers back to the browser.
 */
const MAX_BODY_BYTES = 256 * 1024;

type Context = { params: Promise<{ path: string[] }> };

function readQuery(request: NextRequest): Query {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    const existing = query[key];
    query[key] =
      existing === undefined
        ? value
        : Array.isArray(existing)
          ? [...existing, value]
          : [existing, value];
  }
  return query;
}

async function handle(request: NextRequest, context: Context): Promise<NextResponse> {
  const method = request.method.toUpperCase() as HttpMethod;
  const { path: segments } = await context.params;

  const route = resolveBffRoute(method, segments);
  if (!route) return plainError(404, "NOT_FOUND", "Not found.");

  const csrf = checkCsrf({
    method,
    headers: request.headers,
    allowedOrigins: allowedOrigins(request),
  });
  if (!csrf.ok) return plainError(403, "FORBIDDEN", "Request refused.");

  let body: unknown;
  if (method !== "GET" && method !== "HEAD") {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES)
      return plainError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        return plainError(400, "VALIDATION_FAILED", "The request body is not valid JSON.");
      }
    }
  }

  const rawKey = request.headers.get("idempotency-key") ?? undefined;
  if (rawKey !== undefined && !isValidIdempotencyKey(rawKey)) {
    return plainError(400, "VALIDATION_FAILED", "Invalid Idempotency-Key.");
  }

  let session = route.access === "private" ? await sessionFromRequest(request) : null;
  if (route.access === "private" && !session) {
    return plainError(401, "UNAUTHENTICATED", "Authentication required.");
  }

  let refreshed = false;
  try {
    if (session) {
      ({ data: session, refreshed } = await ensureFreshSession(session));
    }
    const transport = await createServerTransport({ accessToken: session?.accessToken });
    const { status, data } = await transport.requestWithMeta<unknown>({
      method,
      path: route.path,
      query: readQuery(request),
      body,
      idempotencyKey: rawKey,
      signal: request.signal,
    });
    const response =
      status === 204 || data === undefined
        ? new NextResponse(null, { status })
        : NextResponse.json(data, { status });
    noStore(response);
    return session && refreshed ? await commitSession(response, session) : response;
  } catch (error) {
    const response = errorResponse(error);
    // The backend refused the session (revoked, deactivated, reuse detected): drop the cookie.
    return route.access === "private" && isApiError(error) && error.kind === "unauthenticated"
      ? clearSession(response)
      : response;
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
