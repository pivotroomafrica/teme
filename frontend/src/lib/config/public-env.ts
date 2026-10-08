import { parsePublicEnv, type PublicEnv } from "./env";

/**
 * Public configuration. Each NEXT_PUBLIC_ variable must be referenced literally so Next.js can inline it;
 * never spread process.env here. Safe to import from Server and Client Components.
 */
export const publicEnv: PublicEnv = parsePublicEnv({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || undefined,
  NEXT_PUBLIC_SUPPORT_URL: process.env.NEXT_PUBLIC_SUPPORT_URL || undefined,
});
