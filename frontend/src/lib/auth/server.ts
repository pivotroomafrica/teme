import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Me } from "@/lib/api/contract";
import { getServerApi } from "@/lib/api/server";
import { getServerEnv } from "@/lib/config/server-env";
import { isApiError } from "@/lib/errors/api-error";
import type { Locale } from "@/lib/i18n/config";
import type { Branch } from "@/features/branches/api";
import { BRANCH_COOKIE, resolveBranch } from "./branch";
import { PATH_HEADER } from "./constants";
import {
  AREA_ACCOUNT_KIND,
  AREA_ENTRY_PERMISSION,
  canAccess,
  type Area,
  type Principal,
} from "./permissions";
import { SESSION_COOKIE, needsRefresh, openSession, type SessionData } from "./session-data";

export const currentLocation = cache(async (): Promise<string> => {
  const value = (await headers()).get(PATH_HEADER);
  return value && value.startsWith("/") ? value : "/";
});

const readSession = cache(async (): Promise<SessionData | null> => {
  // Read the request first: that is what marks the page as per-request. Configuration is validated only when
  // a real request arrives, so building the app never needs runtime secrets.
  const jar = await cookies();
  const env = getServerEnv();
  return openSession(jar.get(SESSION_COOKIE)?.value, env.TC_SESSION_SECRET, {
    now: Date.now(),
    maxAgeDays: env.TC_SESSION_MAX_AGE_DAYS,
  });
});

export type AuthState =
  | { status: "anonymous" }
  /** The access token is about to expire: the page must send the browser through /api/session/refresh. */
  | { status: "stale" }
  /** The backend refused the session (revoked, deactivated, signed out elsewhere). */
  | { status: "revoked" }
  | { status: "ok"; session: SessionData; me: Me; principal: Principal };

/**
 * Who is making this request, checked with the backend. `/auth/me` is called once per request (cached) and is
 * the source of truth for permissions: the backend reloads the account, role and branch assignments from its
 * database on every call, so a deactivation or role change takes effect immediately.
 */
export const loadAuth = cache(async (): Promise<AuthState> => {
  const session = await readSession();
  if (!session) return { status: "anonymous" };
  if (needsRefresh(session, Date.now())) return { status: "stale" };
  try {
    const me = await (await getServerApi({ accessToken: session.accessToken })).auth.me();
    return { status: "ok", session, me, principal: { kind: me.kind, permissions: me.permissions } };
  } catch (error) {
    if (isApiError(error) && (error.kind === "unauthenticated" || error.kind === "forbidden")) {
      return { status: "revoked" };
    }
    throw error;
  }
});

export type AuthContext = Extract<AuthState, { status: "ok" }>;

/** Sends anyone who is not signed in to the right place; returns the context otherwise. */
async function requireSignedIn(locale: Locale): Promise<AuthContext> {
  const state = await loadAuth();
  if (state.status === "ok") return state;
  const here = await currentLocation();
  if (state.status === "stale") {
    redirect(`/api/session/refresh?locale=${locale}&next=${encodeURIComponent(here)}`);
  }
  if (state.status === "revoked") redirect(`/api/session/end?reason=revoked&locale=${locale}`);
  redirect(`/${locale}/login?next=${encodeURIComponent(here)}`);
}

/** Layout-level check: the right kind of account with the area's entry permission. */
export async function requireArea(locale: Locale, area: Area): Promise<AuthContext> {
  const ctx = await requireSignedIn(locale);
  const allowed =
    AREA_ACCOUNT_KIND[area] === ctx.principal.kind &&
    ctx.principal.permissions.includes(AREA_ENTRY_PERMISSION[area]);
  if (!allowed) redirect(`/${locale}/denied`);
  return ctx;
}

/** Page-level check: the exact permission for this route. Every protected page calls it first. */
export async function requireRoute(locale: Locale, restPath: string): Promise<AuthContext> {
  const ctx = await requireSignedIn(locale);
  if (!canAccess(restPath, ctx.principal)) redirect(`/${locale}/denied`);
  return ctx;
}

/** The business name for merchant users who may read it (staff cannot, and see their branch instead). */
export const loadBusinessName = cache(
  async (): Promise<{ nameEn: string; nameAm: string | null } | null> => {
    const state = await loadAuth();
    if (state.status !== "ok" || !state.principal.permissions.includes("merchant:read"))
      return null;
    try {
      return await (
        await getServerApi({ accessToken: state.session.accessToken })
      ).merchant.getProfile();
    } catch {
      return null;
    }
  },
);

/** The branches this account may use and the one it is working at (remembered choice, or the only one). */
export const loadBranches = cache(
  async (): Promise<{ branches: Branch[]; current: Branch | undefined }> => {
    const state = await loadAuth();
    if (state.status !== "ok") return { branches: [], current: undefined };
    const branches = await (
      await getServerApi({ accessToken: state.session.accessToken })
    ).branches.list();
    const remembered = (await cookies()).get(BRANCH_COOKIE)?.value;
    return { branches, current: resolveBranch(branches, remembered) };
  },
);
