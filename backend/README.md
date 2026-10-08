# TemelashCard Backend

Multi-tenant digital loyalty-card platform for Ethiopian businesses. This package is the whole backend: a NestJS + TypeScript REST API on PostgreSQL (Prisma). The Next.js frontend lives in `/frontend` and is a separate project; see [docs/frontend-contract.md](docs/frontend-contract.md) for how it should talk to this API.

- REST under `/api/v1`, OpenAPI/Swagger at `/api/docs` (when `SWAGGER_ENABLED=true`).
- English and Amharic content; all timestamps UTC; all ids UUIDs.
- **No payments, revenue, order values or billing data** are collected or stored anywhere (a schema test enforces it).

## Architecture

A modular monolith. Each module under `src/modules/<name>` has:

```
api/             controllers and DTOs (thin: validation + calling a service)
application/     use-cases / services (transactions, orchestration, audit)
domain/          pure rules (no framework, no database), unit tested
infrastructure/  repositories (the only place Prisma is used)
index.ts         the module's public API; other modules import only this
```

Rules, enforced by ESLint and `src/architecture.spec.ts`: Prisma only in `infrastructure/` and `src/database`; modules import each other only through `index.ts`; `domain` imports no framework layer; modules form an acyclic graph.

Key patterns: `TransactionManager.run(db => …)` passes one transaction to repositories (a change, its audit row and its outbox job commit together); a **transactional outbox** delivers wallet updates after the stamp is saved; append-only ledgers corrected by compensating events; idempotency keys on scanner writes; derived (never stored) progress and reward status.

```
 Client ──▶ Throttler ▶ JwtAuth ▶ Permissions ▶ Controller ▶ Service ─▶ Repository ─▶ PostgreSQL
                                                         └─▶ Audit / Outbox (same transaction)
 Outbox worker & scheduler (in-process) ─▶ Wallet providers (Apple, Google, web) · fraud checks · retention
```

### Folder structure

```
backend/
  prisma/            schema.prisma, migrations/, seed (dev) and bootstrap (production) CLIs, reference-data.ts
  src/
    main.ts, app.module.ts, app.setup.ts     process entry, composition root, shared HTTP setup
    config/          environment schema (zod) – validated at start-up
    common/          cross-cutting: errors, logging, pagination, time zones, crypto, decorators
    database/        PrismaService, TransactionManager
    modules/
      auth  tenancy  merchants  branches  staff  loyalty-programs  customers  memberships
      stamps  rewards  redemptions  wallet  jobs  audit  audit-viewer  fraud  privacy  analytics  health
  test/              e2e/ (HTTP + real PostgreSQL), integration/ (schema and DB rules), support/ (fixtures)
  docs/              deep-dive documents (index below)
  docker/            PostgreSQL for local development
  scripts/           local PostgreSQL without Docker, test-database helper
```

## Local setup

Requirements: Node.js 22+ (developed on 24), npm, PostgreSQL 16+ (Docker or the bundled embedded server).

```bash
cd backend
npm install
cp .env.example .env          # placeholders only; set JWT_ACCESS_SECRET to 32+ random characters
npm run db:up                 # PostgreSQL via Docker (also creates the _test database)
#   no Docker?  PGPORT=54329 npm run db:local   (embedded PostgreSQL, data in .pgdata/)
npm run prisma:generate
npm run prisma:migrate:deploy
npm run db:seed               # sample merchant, staff and cards; credentials go to .seed-output.json
npm run start:dev             # http://localhost:3000/api/v1/health , docs at /api/docs
```

### PostgreSQL

- Docker default: `docker/docker-compose.yml` (Postgres 16, user `temelash`, database `temelashcard`, plus `temelashcard_test`).
- Connection string: `DATABASE_URL=postgresql://user:password@host:5432/db?schema=public`. For production add TLS (`sslmode=require`) and a pool size (`connection_limit=10`).
- Tests need a database whose name ends in `_test`; `.env.test` (git-ignored) points the test suite at it.

### Migration workflow

| Task                                                     | Command                                             |
| -------------------------------------------------------- | --------------------------------------------------- |
| New migration after editing `schema.prisma` (dev)        | `npm run prisma:migrate:dev -- --name what_changed` |
| Apply pending migrations (CI / production, never resets) | `npm run prisma:migrate:deploy`                     |
| Status / drift check                                     | `npx prisma migrate status` / `npm run db:drift`    |
| Reset the **test** database (human only, destructive)    | `npm run db:test:reset`                             |

Never edit an applied migration; fix forward. CHECK constraints, partial indexes and append-only triggers (which Prisma cannot express) are appended by hand to the migration that introduces them. Details and rolling-deploy advice: [docs/operations.md](docs/operations.md).

### Seed workflow

- `npm run db:seed` (development): reference data (roles, permissions) plus a platform admin, a sample merchant with two branches, owner/manager/staff accounts, a program and two cards. Idempotent. Passwords and scan tokens are written to the git-ignored `.seed-output.json` (set `SEED_PASSWORD` to choose the password). Never run against production data.
- Production: `NODE_ENV=production npm run db:seed` seeds **reference data only**. Then create the first administrator and merchant with the bootstrap CLI:
  ```bash
  BOOTSTRAP_PASSWORD='a-long-unique-passphrase' npm run bootstrap -- admin ops@example.org "Operations"
  npm run bootstrap -- merchant sample-cafe "Sample Cafe" owner@sample-cafe.example "Owner Name"
  ```
  The owner receives a one-time invitation token and sets their own password.

## Environment variables

Validated at start-up by `src/config/env.schema.ts` (the process refuses to start on invalid values; in production it also rejects placeholder secrets, default database passwords, `http://` CORS origins and fake wallet adapters). Precedence: real environment, `.env.<NODE_ENV>.local`, `.env.<NODE_ENV>`, `.env`. Only `.env.example` is committed.

| Group            | Variables                                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core             | `NODE_ENV`, `PORT`, `LOG_LEVEL`, `DATABASE_URL`, `SWAGGER_ENABLED`                                                                                              |
| HTTP             | `CORS_ORIGINS` (comma-separated), `TRUST_PROXY`, `RATE_LIMIT_MAX`, `RATE_LIMIT_TTL_SECONDS`                                                                     |
| Auth             | `JWT_ACCESS_SECRET`, `JWT_ISSUER`, `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`, `LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_TTL_SECONDS`                 |
| Public enrolment | `ENROLL_RATE_LIMIT_MAX`, `ENROLL_RATE_LIMIT_TTL_SECONDS`                                                                                                        |
| Scanner          | `SCANNER_MIN_INTERVAL_SECONDS`, `IDEMPOTENCY_TTL_HOURS`                                                                                                         |
| Wallet           | `WALLET_MODE` (`fake`/`live`), `WALLET_APPLE_ENABLED`, `WALLET_GOOGLE_ENABLED`, `WALLET_PUBLIC_BASE_URL`, `WALLET_BARCODE_SECRET`, `APPLE_*`, `GOOGLE_WALLET_*` |
| Background work  | `OUTBOX_WORKER_ENABLED`, `OUTBOX_POLL_INTERVAL_MS`, `OUTBOX_BATCH_SIZE`, `SCHEDULER_ENABLED`, `FRAUD_EVALUATION_INTERVAL_MINUTES`, `RETENTION_INTERVAL_HOURS`   |
| Bootstrap CLI    | `BOOTSTRAP_PASSWORD` (only for `npm run bootstrap -- admin`)                                                                                                    |

## Testing

| Suite         | Command                                                                                             | What it covers                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit          | `npm test`                                                                                          | domain rules, config, architecture rules, adapters (no database)                                                                                                        |
| Integration   | `npm run test:integration`                                                                          | schema invariants, constraints, triggers, indexes, concurrency (real PostgreSQL)                                                                                        |
| End-to-end    | `npm run test:e2e`                                                                                  | the real app over HTTP against PostgreSQL: auth, tenancy, scanner, rewards, wallet, audit, fraud, privacy, analytics, route-by-route authorization and OpenAPI coverage |
| Everything    | `npm run test:all`                                                                                  |                                                                                                                                                                         |
| Static checks | `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build`, `npx prisma validate` |                                                                                                                                                                         |

E2E and integration runs first apply migrations to the `_test` database (`pretest:*`). Fixtures create unique data per run, so suites do not need a clean database.

## Authentication, roles and permissions

Email + password (argon2id) → 15-minute access JWT plus a rotating single-use refresh token; permissions are reloaded from PostgreSQL on every request, so role and branch changes apply immediately. Full description: [docs/authentication.md](docs/authentication.md).

| Role             | Scope             | Can                                                                                                                            |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `PLATFORM_ADMIN` | platform          | manage merchants/outbox/users; read cross-tenant audit (explicit `platform:audit:read`); **no implicit access to tenant data** |
| `OWNER`          | one merchant      | everything for the merchant, including privacy operations and fraud settings                                                   |
| `MANAGER`        | one merchant      | daily operations, staff, programs, analytics, audit, reversals; not privacy or fraud settings                                  |
| `STAFF`          | assigned branches | scan, redeem, view programs/branches, search customers (phones masked)                                                         |

The permission catalogue and role mapping live in `prisma/reference-data.ts`. Every route declares its access (`@Public`, `@Permissions`, `@AuthenticatedOnly`); undeclared routes are denied, and a test checks every route against every role.

## Tenant isolation

`merchantId` comes only from the authenticated membership; repositories require it; composite foreign keys make cross-tenant references impossible in the database; another tenant's resource is a `404`. Row-Level Security is a documented option, not enabled: [docs/security.md](docs/security.md#row-level-security-open-decision).

## Loyalty lifecycle

1. A merchant owner creates and activates a **program** (stamps required, cooldown, reward).
2. A customer opens the **join link**, accepts the terms (consent is recorded) and receives a **card token** (QR) and a web card; Apple/Google passes are optional.
3. Staff **scan** the card: one valid visit adds one stamp (cooldown, branch and idempotency rules apply). Completing the card **unlocks a reward**.
4. Staff **redeem** the reward; mistakes are fixed with **reversals** (compensating events, never edits).
5. **Audit**, **fraud flags**, **analytics** and **privacy** tools (export, anonymise, retention) run over the same ledger.

Details: [loyalty-and-enrollment](docs/loyalty-and-enrollment.md), [scanner-and-stamps](docs/scanner-and-stamps.md), [rewards-and-reversals](docs/rewards-and-reversals.md).

## Wallet providers

The backend runs fully without Apple or Google credentials (`WALLET_MODE=fake`, the default; the web card is always available). To go live set `WALLET_MODE=live`, enable the providers you have credentials for, and supply certificate/key **file paths outside the repository**; start-up validates them. Apple needs a Developer Program Pass Type ID certificate and the WWDR certificate; Google needs a Wallet issuer id and a service account. Step-by-step setup, the outbox/retry behaviour and limitations: [docs/wallet-passes.md](docs/wallet-passes.md).

## Deployment

Build with `npm ci && npm run prisma:generate && npm run build`, run `node dist/main.js` with `NODE_ENV=production`, apply migrations with `npm run prisma:migrate:deploy`, seed reference data, bootstrap the first admin and merchant, and put a TLS proxy in front (`TRUST_PROXY`). The same process serves the API and the background workers and is safe to run on several instances. Backups, graceful shutdown, health checks, alerts and a smoke test: [docs/operations.md](docs/operations.md).

## Troubleshooting

See the table in [docs/operations.md](docs/operations.md#troubleshooting). Quick checks: `GET /api/v1/health/ready` (database), the `requestId` in any error body (find the log line), `GET /api/v1/platform/outbox/stats` (wallet delivery), `npx prisma migrate status` (schema).

## Documentation index

| Document                                                           | Topic                                             |
| ------------------------------------------------------------------ | ------------------------------------------------- |
| [docs/data-model.md](docs/data-model.md)                           | Schema, invariants, append-only rules             |
| [docs/authentication.md](docs/authentication.md)                   | Accounts, tokens, authorization, tenancy          |
| [docs/organization-management.md](docs/organization-management.md) | Merchant, branches, staff                         |
| [docs/loyalty-and-enrollment.md](docs/loyalty-and-enrollment.md)   | Programs, enrolment, consent, customer search     |
| [docs/scanner-and-stamps.md](docs/scanner-and-stamps.md)           | Scanner, stamp engine, idempotency                |
| [docs/rewards-and-reversals.md](docs/rewards-and-reversals.md)     | Rewards, redemption, reversals                    |
| [docs/wallet-passes.md](docs/wallet-passes.md)                     | Wallet adapters, outbox worker, credentials       |
| [docs/audit-fraud-privacy.md](docs/audit-fraud-privacy.md)         | Audit, fraud indicators, privacy, retention       |
| [docs/analytics.md](docs/analytics.md)                             | Metric definitions and performance                |
| [docs/security.md](docs/security.md)                               | Control matrix, review findings, known weaknesses |
| [docs/operations.md](docs/operations.md)                           | Deployment, migrations, backups, troubleshooting  |
| [docs/frontend-contract.md](docs/frontend-contract.md)             | What the Next.js frontend should build against    |
