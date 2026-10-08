import type { Session } from "@/lib/api/contract";
import { sessionFromLogin, type SessionData } from "./session-data";

/**
 * Refreshing a session without killing it.
 *
 * The backend's refresh tokens are single use, and presenting an already-used one is treated as theft: the
 * whole session is revoked. Two requests that notice an expiring access token at the same moment (a page and
 * an API call, two tabs) would both send the same refresh token, and the second would end the session.
 *
 * So all refreshes of one refresh token share ONE backend call (single flight), and the answer is remembered
 * for a short grace period so a request that still carries the old cookie gets the same new session instead
 * of replaying the old token. State lives on `globalThis` (not module scope) so route handlers and pages in
 * the same Node process share it. Limitation, documented in docs/authentication.md: with several server
 * instances this protects each instance only; use sticky sessions or a shared cache for full cover.
 */
const GRACE_MS = 30_000;

interface Flight {
  promise: Promise<Session>;
}

type Store = Map<string, Flight>;
const globalKey = Symbol.for("temelashcard.refreshFlights");
const store = (): Store => {
  const holder = globalThis as unknown as Record<symbol, Store | undefined>;
  return (holder[globalKey] ??= new Map());
};

export interface RefreshDeps {
  /** Calls the backend: POST /auth/refresh. */
  refresh: (refreshToken: string) => Promise<Session>;
  now: () => number;
}

export async function refreshSessionData(
  current: SessionData,
  deps: RefreshDeps,
): Promise<SessionData> {
  const flights = store();
  let flight = flights.get(current.refreshToken);
  if (!flight) {
    const promise = deps.refresh(current.refreshToken);
    flight = { promise };
    flights.set(current.refreshToken, flight);
    const forget = () => {
      const timer = setTimeout(() => flights.delete(current.refreshToken), GRACE_MS);
      timer.unref?.();
    };
    promise.then(forget, forget);
  }
  const session = await flight.promise;
  // Keep the original sign-in time: rotating tokens must not extend the absolute session limit.
  return sessionFromLogin(session, deps.now(), current.issuedAt);
}

/** Test helper: forget remembered refreshes. */
export function resetRefreshFlights(): void {
  store().clear();
}
