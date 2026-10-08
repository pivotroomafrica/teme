/** Which branch a staff member is working at. A preference, not a credential: validated server-side on every use. */
export const BRANCH_COOKIE = "tc_branch";

export function branchCookieOptions(production: boolean) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 30 * 86_400,
  };
}

/**
 * Picks the branch to work at from the ones this account may use: the remembered one if it is still allowed,
 * the only one if there is exactly one, otherwise nothing (the person must choose).
 */
export function resolveBranch<T extends { id: string; status: string }>(
  allowed: readonly T[],
  remembered: string | undefined,
): T | undefined {
  const usable = allowed.filter((b) => b.status === "ACTIVE");
  const chosen = usable.find((b) => b.id === remembered);
  if (chosen) return chosen;
  return usable.length === 1 ? usable[0] : undefined;
}
