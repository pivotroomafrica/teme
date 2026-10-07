import { z } from 'zod';

const boolFromString = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Blank values in .env files mean "not set". */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );

const PLACEHOLDER = /replace_with|change_me|changeme|test_only|example|0{8,}/i;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    SWAGGER_ENABLED: boolFromString.default(false),
    /**
     * Number of reverse proxies in front of the app whose X-Forwarded-For is trusted (0 = none). Without the
     * right value every client looks like the proxy and shares one rate-limit budget, or a client can spoof its IP.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    DATABASE_URL: z
      .string()
      .url()
      .refine((v) => v.startsWith('postgresql://') || v.startsWith('postgres://'), {
        message: 'must be a PostgreSQL URL',
      }),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().min(1).default('temelashcard'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    LOGIN_RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    // Built-in guard against accidental double scans, applied even when a program has no cooldown.
    SCANNER_MIN_INTERVAL_SECONDS: z.coerce.number().int().min(0).max(3600).default(10),
    IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(48),
    ENROLL_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    ENROLL_RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    // ── Wallet passes ──
    // 'fake' runs everything with in-memory adapters (no credentials). 'live' talks to Apple and Google.
    WALLET_MODE: z.enum(['fake', 'live']).default('fake'),
    WALLET_APPLE_ENABLED: boolFromString.default(false),
    WALLET_GOOGLE_ENABLED: boolFromString.default(false),
    /** Public base URL of this API as seen by phones and wallet providers (used in links). */
    WALLET_PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
    /** Secret from which each pass's barcode is derived. Required when a provider is enabled. */
    WALLET_BARCODE_SECRET: optionalString.pipe(z.string().min(32).optional()),
    // Apple Wallet (live mode). Certificates and keys are FILE PATHS outside the repository.
    APPLE_PASS_TYPE_ID: optionalString,
    APPLE_TEAM_ID: optionalString,
    APPLE_ORGANIZATION_NAME: z.string().default('TemelashCard'),
    APPLE_PASS_CERT_PATH: optionalString,
    APPLE_PASS_KEY_PATH: optionalString,
    APPLE_PASS_KEY_PASSPHRASE: optionalString,
    APPLE_WWDR_CERT_PATH: optionalString,
    APPLE_APNS_HOST: z.string().default('api.push.apple.com'),
    // Google Wallet (live mode).
    GOOGLE_WALLET_ENV: z.enum(['demo', 'production']).default('demo'),
    GOOGLE_WALLET_ISSUER_ID: optionalString,
    GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_PATH: optionalString,
    GOOGLE_WALLET_ORIGINS: csv,
    GOOGLE_WALLET_DEFAULT_LOGO_URL: optionalString,
    GOOGLE_WALLET_API_BASE: z.string().url().default('https://walletobjects.googleapis.com'),
    GOOGLE_OAUTH_TOKEN_URL: z.string().url().default('https://oauth2.googleapis.com/token'),
    // ── Background jobs (transactional outbox worker) ──
    // Periodic jobs (fraud evaluation, retention). Safe on many instances: work is de-duplicated by key.
    SCHEDULER_ENABLED: boolFromString.default(true),
    FRAUD_EVALUATION_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    RETENTION_INTERVAL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    OUTBOX_WORKER_ENABLED: boolFromString.default(true),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(300_000).default(5000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  })
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    if (env.NODE_ENV === 'production') {
      if (env.CORS_ORIGINS.includes('*'))
        issue('CORS_ORIGINS', 'wildcard not allowed in production');
      if (env.CORS_ORIGINS.some((o) => !o.startsWith('https://'))) {
        issue('CORS_ORIGINS', 'production origins must use https');
      }
      if (PLACEHOLDER.test(env.JWT_ACCESS_SECRET)) {
        issue('JWT_ACCESS_SECRET', 'looks like a placeholder; generate a long random value');
      }
      if (/:(change_me|password|postgres)@/i.test(env.DATABASE_URL)) {
        issue('DATABASE_URL', 'uses a placeholder or default password');
      }
    }

    // Wallet configuration is validated only for providers that are switched on.
    const anyWallet = env.WALLET_APPLE_ENABLED || env.WALLET_GOOGLE_ENABLED;
    if (anyWallet && !env.WALLET_BARCODE_SECRET) {
      issue('WALLET_BARCODE_SECRET', 'required (min 32 chars) when a wallet provider is enabled');
    }
    if (anyWallet && env.WALLET_MODE === 'fake' && env.NODE_ENV === 'production') {
      issue('WALLET_MODE', 'fake wallet adapters are not allowed in production');
    }
    if (anyWallet && env.WALLET_MODE === 'live') {
      if (!env.WALLET_PUBLIC_BASE_URL.startsWith('https://')) {
        issue('WALLET_PUBLIC_BASE_URL', 'must be https in live wallet mode');
      }
      if (env.WALLET_APPLE_ENABLED) {
        for (const key of [
          'APPLE_PASS_TYPE_ID',
          'APPLE_TEAM_ID',
          'APPLE_PASS_CERT_PATH',
          'APPLE_PASS_KEY_PATH',
          'APPLE_WWDR_CERT_PATH',
        ] as const) {
          if (!env[key]) issue(key, 'required when Apple Wallet is enabled in live mode');
        }
      }
      if (env.WALLET_GOOGLE_ENABLED) {
        for (const key of [
          'GOOGLE_WALLET_ISSUER_ID',
          'GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_PATH',
          'GOOGLE_WALLET_DEFAULT_LOGO_URL',
        ] as const) {
          if (!env[key]) issue(key, 'required when Google Wallet is enabled in live mode');
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
