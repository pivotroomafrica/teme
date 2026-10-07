import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Runs before every test file. Real environment variables win, so CI can override.
// (Parsed by hand: process.loadEnvFile does not reach Jest's sandboxed process.env.)
const envTest = join(__dirname, '..', '..', '.env.test');
if (existsSync(envTest)) {
  for (const line of readFileSync(envTest, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? '';
  }
}

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.SWAGGER_ENABLED ??= 'true';
process.env.CORS_ORIGINS ??= 'http://localhost:3001';
process.env.DATABASE_URL ??=
  'postgresql://temelash:change_me@localhost:5432/temelashcard_test?schema=public';
process.env.JWT_ACCESS_SECRET ??= 'test_only_secret_test_only_secret_1234567890';
process.env.LOGIN_RATE_LIMIT_MAX ??= '1000';
process.env.RATE_LIMIT_MAX ??= '100000';
process.env.ENROLL_RATE_LIMIT_MAX ??= '100000';
process.env.SCANNER_MIN_INTERVAL_SECONDS ??= '0';
process.env.OUTBOX_WORKER_ENABLED ??= 'false';
process.env.WALLET_BARCODE_SECRET ??= 'test-wallet-barcode-secret-0123456789abcdef';
process.env.SCHEDULER_ENABLED ??= 'false';
