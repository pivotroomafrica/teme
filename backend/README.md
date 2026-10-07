# TemelashCard Backend

NestJS + Prisma + PostgreSQL. REST API under `/api/v1`, Swagger at `/api/docs` (when `SWAGGER_ENABLED=true`).

## Quick start

```bash
cd backend
npm install
cp .env.example .env        # fill in placeholders
npm run db:up               # PostgreSQL 16 via Docker (also creates temelashcard_test)
npm run prisma:generate
npm run prisma:migrate:dev  # no migrations until the schema step
npm run start:dev
```

Health: `GET /api/v1/health` (liveness), `GET /api/v1/health/ready` (database).

### Database workflow

| Task                                                                  | Command                         |
| --------------------------------------------------------------------- | ------------------------------- |
| PostgreSQL via Docker (default)                                       | `npm run db:up`                 |
| PostgreSQL without Docker (dev only, `PGPORT=54329 npm run db:local`) | `npm run db:local`              |
| Apply migrations (dev, also regenerates client)                       | `npm run prisma:migrate:dev`    |
| Apply migrations (CI / production)                                    | `npm run prisma:migrate:deploy` |
| Seed (reference data + sample merchant; production = reference only)  | `npm run db:seed`               |
| Reset the **test** database (human only, destructive)                 | `npm run db:test:reset`         |

Seed credentials and sample scan tokens are written to the gitignored `.seed-output.json`.
Schema documentation and invariants: [docs/data-model.md](docs/data-model.md). Authentication and tenancy: [docs/authentication.md](docs/authentication.md). Merchant, branch and staff management: [docs/organization-management.md](docs/organization-management.md). Programs, enrollment and consent: [docs/loyalty-and-enrollment.md](docs/loyalty-and-enrollment.md). Scanner and stamping: [docs/scanner-and-stamps.md](docs/scanner-and-stamps.md). Rewards, redemption and reversals: [docs/rewards-and-reversals.md](docs/rewards-and-reversals.md). Wallet passes, outbox worker and credential setup: [docs/wallet-passes.md](docs/wallet-passes.md). Audit, fraud indicators and privacy: [docs/audit-fraud-privacy.md](docs/audit-fraud-privacy.md). Analytics and metric definitions: [docs/analytics.md](docs/analytics.md).
Constraints Prisma cannot express (CHECKs, partial indexes, append-only triggers) live in the
`*_integrity_constraints` migration; change them with a new migration, never by editing applied ones.

## Scripts

| Task                                 | Command                                                       |
| ------------------------------------ | ------------------------------------------------------------- |
| Unit tests                           | `npm test`                                                    |
| Integration tests (needs PostgreSQL) | `npm run test:integration`                                    |
| E2E tests (database stubbed for now) | `npm run test:e2e`                                            |
| Lint / format check / typecheck      | `npm run lint` / `npm run format:check` / `npm run typecheck` |
| Production build                     | `npm run build` then `npm run start:prod`                     |

## Layout

See `src/modules/*`: each module has `api/` (controllers, DTOs), `application/` (use-cases),
`domain/` (pure rules), `infrastructure/` (repositories) and a public `index.ts`.
Only `infrastructure/` and `src/database` may import `@prisma/client` (enforced by ESLint).

## Configuration

Environment is validated at startup (`src/config/env.schema.ts`). Files loaded in order of
precedence: real env vars, `.env.<NODE_ENV>.local`, `.env.<NODE_ENV>`, `.env`. Only
`.env.example` is committed. Wallet credentials must live outside the repo (`secrets/` is gitignored).
