import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getServerApi } from "@/lib/api/server";
import { getServerEnv } from "@/lib/config/server-env";
import { publicEnv } from "@/lib/config/public-env";
import { ApiError, toApiError } from "@/lib/errors/api-error";
import { refreshSessionData } from "./refresh";
import {
  SESSION_COOKIE,
  needsRefresh,
  openSession,
  sealSession,
  sessionCookieOptions,
  type SessionData,
} from "./session-data";

/** Origins this app answers for: the configured public URL plus the origin the request actually used. */
export function allowedOrigins(request: NextRequest): string[] {
  return [...new Set([new URL(publicEnv.NEXT_PUBLIC_APP_URL).origin, request.nextUrl.origin])];
}

export async function sessionFromRequest(request: NextRequest): Promise<SessionData | null> {
  const env = getServerEnv();
  return openSession(request.cookies.get(SESSION_COOKIE)?.value, env.TC_SESSION_SECRET, {
    now: Date.now(),
    maxAgeDays: env.TC_SESSION_MAX_AGE_DAYS,
  });
}

/** Writes the sealed session onto a response. The cookie is HttpOnly: browser scripts never see the tokens. */
export async function commitSession<T extends NextResponse>(
  response: T,
  data: SessionData,
): Promise<T> {
  const env = getServerEnv();
  response.cookies.set(
    SESSION_COOKIE,
    await sealSession(data, env.TC_SESSION_SECRET),
    sessionCookieOptions(env.TC_SESSION_MAX_AGE_DAYS, env.NODE_ENV === "production"),
  );
  return response;
}

export function clearSession<T extends NextResponse>(response: T): T {
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true });
  return response;
}

/**
 * Returns a session whose access token is good for at least the next few seconds, refreshing (once, shared
 * between concurrent callers) when it is not. Throws ApiError("unauthenticated") when the backend refuses.
 */
export async function ensureFreshSession(
  data: SessionData,
): Promise<{ data: SessionData; refreshed: boolean }> {
  if (!needsRefresh(data, Date.now())) return { data, refreshed: false };
  const api = await getServerApi();
  const next = await refreshSessionData(data, {
    refresh: (token) => api.auth.refresh(token),
    now: () => Date.now(),
  });
  return { data: next, refreshed: true };
}

/** The backend's error envelope, so browser code handles proxy errors exactly like direct ones. */
export function errorResponse(error: ApiError | unknown, fallbackStatus = 502): NextResponse {
  const e = toApiError(error);
  const status =
    e.status ??
    (e.kind === "timeout"
      ? 504
      : e.kind === "aborted"
        ? 400
        : e.kind === "network"
          ? 502
          : fallbackStatus);
  const response = NextResponse.json(
    {
      error: {
        code: e.code,
        message:
          e.kind === "network" || e.kind === "timeout"
            ? "The service could not be reached."
            : e.message,
        ...(e.details !== undefined ? { details: e.details } : {}),
        requestId: e.requestId ?? "unknown",
        timestamp: new Date().toISOString(),
      },
    },
    { status },
  );
  if (e.retryAfterSeconds !== undefined)
    response.headers.set("Retry-After", String(e.retryAfterSeconds));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function plainError(status: number, code: string, message: string): NextResponse {
  return errorResponse(
    new ApiError({ kind: status === 401 ? "unauthenticated" : "unknown", status, code, message }),
  );
}

export const noStore = <T extends NextResponse>(response: T): T => {
  response.headers.set("Cache-Control", "no-store");
  return response;
};
