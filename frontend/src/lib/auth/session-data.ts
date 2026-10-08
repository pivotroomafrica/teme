import type { Session } from "@/lib/api/contract";
import { seal, unseal } from "./seal";

/** Name of the sealed, HttpOnly session cookie. */
export const SESSION_COOKIE = "tc_session";

export type AccountKind = "platform" | "merchant";

/** What the sealed cookie holds. Only this server ever reads it; browser JavaScript cannot. */
export interface SessionData {
  v: 1;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token stops working. */
  accessExpiresAt: number;
  /** Epoch ms when this browser first signed in (rotation keeps it): enforces the absolute session limit. */
  issuedAt: number;
  user: {
    id: string;
    displayName: string;
    role: string;
    kind: AccountKind;
    merchantId: string | null;
  };
}

/** Refresh slightly before the access token ends so a request never starts with a token about to expire. */
export const ACCESS_REFRESH_SKEW_MS = 30_000;

export function sessionFromLogin(session: Session, now: number, issuedAt = now): SessionData {
  return {
    v: 1,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accessExpiresAt: now + session.expiresIn * 1000,
    issuedAt,
    user: {
      id: session.user.id,
      displayName: session.user.displayName,
      role: session.user.role,
      kind: session.user.accountType === "PLATFORM_ADMIN" ? "platform" : "merchant",
      merchantId: session.user.merchantId,
    },
  };
}

export const needsRefresh = (data: SessionData, now: number): boolean =>
  data.accessExpiresAt - now <= ACCESS_REFRESH_SKEW_MS;

export const isWithinMaxAge = (data: SessionData, now: number, maxAgeDays: number): boolean =>
  now - data.issuedAt < maxAgeDays * 86_400_000;

function isSessionData(value: unknown): value is SessionData {
  const v = value as Partial<SessionData> | null;
  return (
    !!v &&
    v.v === 1 &&
    typeof v.accessToken === "string" &&
    typeof v.refreshToken === "string" &&
    typeof v.accessExpiresAt === "number" &&
    typeof v.issuedAt === "number" &&
    !!v.user &&
    typeof v.user.id === "string" &&
    typeof v.user.role === "string" &&
    (v.user.kind === "platform" || v.user.kind === "merchant")
  );
}

export const sealSession = (data: SessionData, secret: string) => seal(data, secret);

/** The session in a cookie value, or null if it is missing, forged, corrupt or older than the absolute limit. */
export async function openSession(
  cookie: string | undefined,
  secret: string,
  options: { now: number; maxAgeDays: number },
): Promise<SessionData | null> {
  const data = await unseal<unknown>(cookie, secret);
  if (!isSessionData(data) || !isWithinMaxAge(data, options.now, options.maxAgeDays)) return null;
  return data;
}

/** Cookie attributes. SameSite=Lax (not Strict) so following a link from e-mail keeps you signed in; the
 * unsafe methods are protected by the Origin check and a custom header instead (see csrf.ts). */
export function sessionCookieOptions(maxAgeDays: number, production: boolean) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeDays * 86_400,
  };
}
