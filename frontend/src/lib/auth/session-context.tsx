"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AccountKind } from "./session-data";

/** What client components may know about the signed-in person. No tokens: those never leave the server. */
export interface SessionView {
  displayName: string;
  role: string;
  kind: AccountKind;
  permissions: readonly string[];
}

const SessionContext = createContext<SessionView | null>(null);

export function SessionProvider({ value, children }: { value: SessionView; children: ReactNode }) {
  const stable = useMemo(() => value, [value]);
  return <SessionContext.Provider value={stable}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionView {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

/**
 * Whether to SHOW something. This only shapes the interface: the server re-checks every page and the
 * backend re-checks every request, so hiding a button here is never the only protection.
 */
export function useCan(permission: string): boolean {
  return useSession().permissions.includes(permission);
}
