import { meSchema, parseWith, sessionSchema, type Me, type Session } from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";
import type { RequestBody } from "@/lib/api/types";

export type LoginInput = RequestBody<"/auth/login", "post">;

/** Authentication operations of the backend (see backend/docs/authentication.md). */
export function createAuthApi(transport: Transport) {
  return {
    /** Wrong password, unknown account, deactivation and lockout all answer the same 401. */
    login: (input: LoginInput, signal?: AbortSignal) =>
      transport.request<Session>({
        method: "POST",
        path: "/auth/login",
        body: input,
        signal,
        parse: parseWith(sessionSchema),
      }),

    /** Refresh tokens are single use: always store the NEW pair this returns. */
    refresh: (refreshToken: string, signal?: AbortSignal) =>
      transport.request<Session>({
        method: "POST",
        path: "/auth/refresh",
        body: { refreshToken },
        signal,
        parse: parseWith(sessionSchema),
      }),

    /** Always succeeds (204), even for an unknown token. */
    logout: (refreshToken: string, signal?: AbortSignal) =>
      transport.request<void>({
        method: "POST",
        path: "/auth/logout",
        body: { refreshToken },
        signal,
      }),

    logoutAllDevices: (signal?: AbortSignal) =>
      transport.request<void>({ method: "POST", path: "/auth/logout-all", signal }),

    /**
     * A new team member sets a password with the one-time invitation code (204). Unknown, expired, revoked and used
     * codes all answer the same 400 INVALID_INVITATION. Afterwards the person signs in normally.
     */
    acceptInvitation: (input: { token: string; password: string }, signal?: AbortSignal) =>
      transport.request<void>({
        method: "POST",
        path: "/auth/invitations/accept",
        body: input,
        signal,
      }),

    me: (signal?: AbortSignal) =>
      transport.request<Me>({
        method: "GET",
        path: "/auth/me",
        signal,
        parse: parseWith(meSchema),
      }),
  };
}
export type AuthApi = ReturnType<typeof createAuthApi>;
