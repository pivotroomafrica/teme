import { z } from "zod";

/**
 * Environment validation. Two separate schemas keep secrets out of the browser by construction:
 *  - `serverEnvSchema`: read only on the server (this file's `getServerEnv`, guarded by "server-only" in server-env.ts)
 *  - `publicEnvSchema`: the only values that may ever be inlined into client JavaScript (NEXT_PUBLIC_*)
 * Both are pure functions of an object so they can be unit tested without touching process.env.
 */

const PLACEHOLDER = /replace_with|change_me|changeme|example|test_only|0{8,}/i;

export const publicEnvSchema = z.object({
  /** Public origin of this frontend, used for canonical URLs and the CSRF origin check. */
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3001"),
  /** Where customers get help: an https page or a mailto: address. Optional; the card page falls back to "ask the staff". */
  NEXT_PUBLIC_SUPPORT_URL: z
    .string()
    .regex(/^(https:\/\/|mailto:)\S+$/, "must be an https:// link or a mailto: address")
    .optional(),
});

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** Backend base URL including the version prefix, e.g. https://api.example.org/api/v1 (server-side only). */
    TC_API_BASE_URL: z.url().default("http://localhost:3000/api/v1"),
    /** `live` talks to the backend; `mock` serves typed fixtures (development and tests only). */
    TC_API_MODE: z.enum(["live", "mock"]).default("live"),
    /** Seals the session cookie that holds the backend tokens. 32+ random characters. */
    TC_SESSION_SECRET: z.string().min(32),
    /** How long a signed-in browser stays signed in at most (the backend refresh token lives 30 days by default). */
    TC_SESSION_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    /** Backend request timeout in milliseconds. */
    TC_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (env.TC_API_MODE !== "live") issue("TC_API_MODE", "mock mode is not allowed in production");
    if (!env.TC_API_BASE_URL.startsWith("https://"))
      issue("TC_API_BASE_URL", "must use https in production");
    if (PLACEHOLDER.test(env.TC_SESSION_SECRET)) {
      issue("TC_SESSION_SECRET", "looks like a placeholder; generate a long random value");
    }
  });

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

function format(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
}

export function parsePublicEnv(raw: Record<string, unknown>): PublicEnv {
  const result = publicEnvSchema.safeParse(raw);
  if (!result.success) throw new Error(`Invalid public environment:\n${format(result.error)}`);
  return result.data;
}

export function parseServerEnv(raw: Record<string, unknown>): ServerEnv {
  const result = serverEnvSchema.safeParse(raw);
  if (!result.success) throw new Error(`Invalid server environment:\n${format(result.error)}`);
  return result.data;
}

/**
 * Names that must never carry a NEXT_PUBLIC_ prefix: anything that looks like a credential would be shipped
 * to every browser. Checked in tests against the real environment and in `assertNoPublicSecrets`.
 */
const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASSPHRASE|PRIVATE|CREDENTIAL|API_KEY)/i;

export function assertNoPublicSecrets(env: Record<string, unknown>): void {
  const offenders = Object.keys(env).filter(
    (k) => k.startsWith("NEXT_PUBLIC_") && SECRET_NAME.test(k),
  );
  if (offenders.length > 0) {
    throw new Error(`Secrets must not be exposed to the browser: ${offenders.join(", ")}`);
  }
}
