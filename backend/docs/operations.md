# Operations: deployment, migrations, backups, troubleshooting

## Runtime model

One stateless Node process (`node dist/main.js`) serves the API **and** runs two in-process background workers: the outbox worker (wallet pass updates, with retries) and the scheduler (fraud evaluation, retention, clean-up). Both are safe on several instances: outbox jobs are claimed with `FOR UPDATE SKIP LOCKED`, scheduled work is de-duplicated by a time-bucket key. PostgreSQL is the only stateful dependency. Use `OUTBOX_WORKER_ENABLED=false` / `SCHEDULER_ENABLED=false` to dedicate instances to API or to jobs.

## First production deployment

1. Provision PostgreSQL 16+ (managed, with automated backups and TLS). Create a database and a role that owns it. Put the URL in `DATABASE_URL`; add `?sslmode=require` (or your provider's equivalent) and a pool size such as `&connection_limit=10`.
2. Build and ship: `npm ci && npm run prisma:generate && npm run build`. Run `node dist/main.js` under a supervisor (systemd, Docker, your platform's process manager) with `NODE_ENV=production`.
3. Set the environment ([README](../README.md#environment-variables)). In production the process **refuses to start** on a placeholder `JWT_ACCESS_SECRET`, a default database password, non-`https` CORS origins, `*` CORS, or fake wallet adapters with a provider enabled. Generate the JWT secret with `openssl rand -base64 48`.
4. Apply migrations: `npm run prisma:migrate:deploy`.
5. Seed reference data (roles, permissions): `NODE_ENV=production npm run db:seed`. This creates **no** users or merchants.
6. Create the first platform administrator and the first merchant:

   ```bash
   BOOTSTRAP_PASSWORD='a-long-unique-passphrase' npm run bootstrap -- admin ops@example.org "Operations"
   npm run bootstrap -- merchant sample-cafe "Sample Cafe" owner@sample-cafe.example "Owner Name"
   ```

   The second command prints a one-time invitation token (valid 7 days). The owner sets their own password with `POST /api/v1/auth/invitations/accept {token, password}` and then signs in. Neither command overwrites existing data, and both write a `platform.*_bootstrapped` audit event.

7. Put a TLS-terminating reverse proxy or load balancer in front, set `TRUST_PROXY` to the number of proxies (usually `1`), and point load-balancer health checks at `GET /api/v1/health/ready`.
8. Keep `SWAGGER_ENABLED=false` unless the docs are behind authentication.

## Environment checklist

| Variable                           | Production guidance                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `NODE_ENV`                         | `production`                                                                         |
| `DATABASE_URL`                     | TLS, non-default password, bounded pool                                              |
| `JWT_ACCESS_SECRET`                | 32+ random characters, unique per environment                                        |
| `CORS_ORIGINS`                     | exact `https://` origins of the frontend, comma-separated                            |
| `TRUST_PROXY`                      | number of reverse proxies in front (0 only when exposed directly)                    |
| `RATE_LIMIT_MAX`, `*_RATE_LIMIT_*` | tune to the real traffic; counters are per process                                   |
| `WALLET_MODE`                      | `live` once Apple/Google credentials exist; see [wallet-passes.md](wallet-passes.md) |
| `WALLET_BARCODE_SECRET`            | 32+ random characters; **changing it invalidates every issued wallet barcode**       |
| `LOG_LEVEL`                        | `info`                                                                               |

Secrets belong in your platform's secret store, not in files in the repository. Wallet certificates and keys are referenced by path and must live outside the repository (`secrets/` is git-ignored).

## Migration workflow

- **Develop**: edit `prisma/schema.prisma`, run `npm run prisma:migrate:dev -- --name short_description`, review the generated SQL. Constraints Prisma cannot express (CHECKs, partial indexes, triggers) are appended by hand to that migration file before it is first applied.
- **Never edit an applied migration.** Fix forward with a new one.
- **CI / production**: `npm run prisma:migrate:deploy` (applies pending migrations, never resets). `npx prisma migrate status` must report "up to date".
- **Drift check**: `npm run db:drift` exits non-zero if the live database differs from `schema.prisma`.
- **Rolling deploys**: write migrations to be backward compatible with the previous release (add nullable columns / new tables / indexes first; drop or tighten only in a later release). Create large indexes with `CREATE INDEX CONCURRENTLY` in a dedicated migration (Prisma runs each file in a transaction, so such a migration must contain only that statement and be applied with care).
- **Tests** use a separate database whose name ends in `_test`; `npm run db:test:reset` refuses any other name.

## Backups and recovery (expectations)

PostgreSQL holds all state, including the append-only ledgers that are the business record.

- Enable provider-managed **daily full backups plus point-in-time recovery (WAL archiving)**. Target RPO ≤ 5 minutes, RTO ≤ 1 hour for the MVP.
- Keep backups encrypted, in another region/account, for at least 30 days. They contain personal data: apply the same access controls as production, and remember that an anonymisation done after a backup was taken is not reflected in that backup (document your restore-then-reapply procedure: re-run anonymisation requests from the audit log after a restore).
- **Test a restore** into a scratch database at least quarterly and run `npx prisma migrate status` plus the smoke checks below against it.
- The app stores no files and no other state; secrets and wallet credentials are backed up in your secret store, not in the database backup. Losing `WALLET_BARCODE_SECRET` invalidates issued wallet barcodes; losing `JWT_ACCESS_SECRET` only signs everyone out.

## Health, shutdown and observability

- `GET /api/v1/health` is liveness (no dependencies). `GET /api/v1/health/ready` checks PostgreSQL and returns `503` while it is unreachable; the process stays up and recovers by itself.
- **Graceful shutdown**: on `SIGTERM` Nest stops accepting connections, lets in-flight requests finish, stops the outbox worker and scheduler, then disconnects Prisma. Give the platform a termination grace period of at least 30 s. A job that was being processed is released by its lock timeout and retried.
- Logs are JSON on stdout (one line per request with `reqId`, status and duration); send them to your log platform. Correlate with the `X-Request-Id` response header and the error envelope's `requestId`.
- Useful operational endpoints (platform administrators): `GET /api/v1/platform/outbox/stats`, `GET /api/v1/platform/outbox/dead`, `POST /api/v1/platform/outbox/dead/{jobId}/requeue`.
- Suggested alerts: `ready` failing, 5xx rate, dead outbox jobs > 0, outbox backlog age, login `429` spikes, open fraud flags.

## Troubleshooting

| Symptom                                                         | Likely cause and fix                                                                                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process exits at start with `Invalid environment configuration` | The message lists each variable. In production this includes placeholder secrets and `http://` origins.                                                         |
| `/health/ready` is `503`                                        | Database unreachable or credentials wrong. The app keeps running; fix the URL/network and it recovers.                                                          |
| `nest build` ends but `dist/` is missing                        | Fixed (non-incremental build). If seen in an older checkout delete `*.tsbuildinfo` and rebuild.                                                                 |
| Everyone gets `429`                                             | Behind a proxy without `TRUST_PROXY`, so all clients share the proxy's IP. Set it.                                                                              |
| A busy shop is rate-limited                                     | Scanners share one IP. Raise `RATE_LIMIT_MAX`.                                                                                                                  |
| Wallet updates not arriving                                     | `GET /platform/outbox/stats`; look at `dead` jobs and `lastError`; fix credentials, then requeue. In `fake` mode nothing reaches real wallets.                  |
| Wallet start-up error about credentials                         | A provider is enabled in `live` mode with a missing/invalid file. Paths and PEM validity are checked at start.                                                  |
| `409 CONFLICT`/`IDEMPOTENCY_KEY_REUSED` from the scanner        | The app reused a key for a different card; generate a fresh `Idempotency-Key` per scan attempt.                                                                 |
| A staff member cannot scan at a branch                          | `BRANCH_NOT_PERMITTED`: branch not assigned or inactive.                                                                                                        |
| Owner lost their password                                       | No reset endpoint yet: re-issue an invitation (`POST /merchant/staff/{id}/invitation`) from another owner, or use `npm run bootstrap` for a new platform admin. |
| Test failures with "relation does not exist"                    | `npm run pretest:e2e` (applies migrations to the test DB) or `npm run db:test:reset`.                                                                           |

## Smoke test after a deploy

```bash
curl -fsS https://api.example.org/api/v1/health/ready
curl -fsS -X POST https://api.example.org/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"ops@example.org","password":"…"}' | head -c 120
```
