# TemelashCard Frontend

The web app for TemelashCard, a multi-tenant digital loyalty-card platform for Ethiopian businesses. One Next.js application serves four audiences:

- **Customers** join a loyalty program from a QR code, choose a wallet, and keep a web card with their progress.
- **Branch staff** scan cards and give stamps and rewards.
- **Merchants** (owners and managers) run their program, branches, team, customers, analytics and audit history.
- **TemelashCard operations** (platform administrators) look after merchants, background jobs and the service.

English and Amharic throughout. Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · TanStack Query · React Hook Form + Zod · Vitest, React Testing Library and Playwright.

The backend lives in `../backend` and is never modified from here. The frontend carries no payment, revenue, billing or subscription features: loyalty activity only.

> Next.js 16 differs from earlier versions (for example `middleware` is now `proxy`). Read the bundled docs in `node_modules/next/dist/docs/` before changing framework-level code.

## Contents

[Quick start](#quick-start) · [Scripts](#scripts) · [Environment variables](#environment-variables) · [Architecture](#architecture) · [Folder structure](#folder-structure) · [API client generation](#api-client-generation) · [Mock mode](#mock-mode) · [Authentication](#authentication) · [Localization](#localization) · [Roles and permissions](#roles-and-permissions) · [Routes](#routes) · [Testing](#testing) · [Security](#security) · [Accessibility](#accessibility) · [Performance](#performance) · [Deployment](#deployment) · [Troubleshooting](#troubleshooting) · [Guides](#guides)

## Quick start

```bash
cd frontend
npm install
npx playwright install chromium           # once, for the browser tests
cp .env.example .env.development.local    # then set TC_SESSION_SECRET (32+ random characters)
```

To try everything without a backend, use the built-in mock backend. In `.env.development.local` set:

```
TC_API_MODE=mock
TC_SESSION_SECRET=any-long-random-value-of-at-least-32-characters
```

```bash
npm run dev                               # http://localhost:3001
```

Sign in at `/en/login` with a mock account (password `mock-password-1`): `owner@mock.test`, `manager@mock.test`, `staff@mock.test`, `viewer@mock.test` or `admin@mock.test`. The table of accounts, join links, card tokens and magic values is in [src/mocks/README.md](src/mocks/README.md).

To use a real backend instead, set `TC_API_MODE=live` and `TC_API_BASE_URL` (including `/api/v1`) to a running `../backend`.

## Scripts

| Task                       | Command                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- |
| Dev server (port 3001)     | `npm run dev`                                                                 |
| Production build / serve   | `npm run build` then `npm start`                                              |
| Format / lint / types      | `npm run format:check` · `npm run lint` · `npm run typecheck`                 |
| Unit and component tests   | `npm test` (Vitest + React Testing Library); `npm run test:watch`             |
| End-to-end and a11y tests  | `npm run test:e2e` (Playwright; builds and serves the app itself)             |
| API types                  | `npm run api:sync` · `npm run api:generate` · `npm run api:check`             |
| Bundle leak check / report | `npm run check:bundle` · `npm run report:bundle` (after a build)              |
| Everything except e2e      | `npm run check` (format, lint, types, API check, tests, build, bundle checks) |

## Environment variables

Validated by Zod (`src/lib/config/env.ts`); the app refuses to start on invalid values. Files named `.env*` are git-ignored except `.env.example`. Server variables carry a `TC_` prefix on purpose: generic names such as `API_MODE` collide with variables that hosting platforms already define.

| Variable                  | Where       | Purpose                                                                                              |
| ------------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| `TC_API_BASE_URL`         | server only | Backend base URL including `/api/v1`. Must be `https` in production.                                 |
| `TC_API_MODE`             | server only | `live` or `mock`. `mock` is rejected in production.                                                  |
| `TC_SESSION_SECRET`       | server only | Seals the session cookie (32+ chars). Placeholders rejected in production.                           |
| `TC_API_TIMEOUT_MS`       | server only | Backend request timeout (default 10000).                                                             |
| `TC_SESSION_MAX_AGE_DAYS` | server only | Absolute session lifetime in days (default 30; keep at or below the backend refresh-token lifetime). |
| `NEXT_PUBLIC_APP_URL`     | public      | Public origin of this site (canonical URLs, origin checks).                                          |
| `NEXT_PUBLIC_SUPPORT_URL` | public      | Optional `https://` or `mailto:` link shown on the customer card.                                    |

Anything prefixed `NEXT_PUBLIC_` is shipped to every browser, so secrets must never use that prefix (a test and a start-up check enforce this). **Backend secrets, wallet-provider private keys and signing certificates never belong in this project.** Development reads `.env.development.local`; tests set their variables in the Vitest and Playwright configuration; production uses real environment variables from your platform.

## Architecture

```
Browser ──► Next.js (this app) ──► Backend API (NestJS, /api/v1)
 pages        │ Server Components fetch with the signed-in user's token
 forms        │ /api/session/*   sign-in, sign-out, refresh (own handlers)
 queries      │ /api/bff/*       allow-listed same-origin proxy for Client Components
              └ proxy.ts         language routing, nonce CSP, noindex headers, early sign-in redirect
```

- **Backend-for-frontend.** The backend access and refresh tokens live only in a sealed (AES-GCM), HttpOnly, SameSite cookie. Browser JavaScript never sees a token. Client Components call `/api/bff/*`, which checks an allow-list, checks the request's origin (CSRF), adds the bearer token on the server, and sends state-changing requests exactly once.
- **Layers.** Component → feature service (`src/features/<feature>/api.ts`) → transport (`src/lib/api/http.ts`, the only code that does HTTP). The transport is live HTTP or the in-process mock; services are identical in both. Responses are validated at run time with Zod.
- **Server Components by default.** Client Components are used for interaction only. Pages fetch on the server where they can; dashboard sections fetch independently on the client so one slow or failing section never blocks the others.
- **Permissions in two places.** The UI shows only what a person may do (a convenience), the server re-checks every route (`requireRoute`), and the backend re-checks every request. A hidden button is never the protection.
- **Idempotency.** Stamps, redemptions and reversals carry an idempotency key, reused only on a deliberate retry after a lost answer.

## Folder structure

```
src/
  app/
    [locale]/                  every page lives under /en or /am
      (public)/                home, join/[joinReference], card
      (auth)/                  login, accept-invitation, denied, session-expired
      (staff)/                 staff/scanner, staff/branch
      (merchant)/              dashboard/* (program, branches, team, customers, rewards, analytics, audit...)
      (operations)/            operations/* (merchants, wallet-health, privacy, audit, system...)
    api/session/*              sign-in, sign-out, refresh, branch choice
    api/bff/[...path]/         allow-listed proxy to the backend
    api/card/*                 customer card cookie handling
    robots.ts  global-error.tsx
  proxy.ts                     locale routing, per-request nonce CSP, noindex, early auth redirect
  features/<feature>/          api.ts (service), components/, rules and tests together
    analytics audit auth branches card customers dashboard enrollment memberships
    merchant operations org program records rewards scanner team wallet
  components/ui/               design system (native elements, no UI framework)
  components/layout/           shells for each surface, language switcher, state views
  lib/api/                     transport, generated types, Zod contract layer, idempotency
  lib/auth/                    sealed cookies, permissions, route guards, CSRF, redirects
  lib/i18n/                    dictionaries (en, am), translator, formatters, phone helpers
  lib/security/                Content-Security-Policy builder
  lib/config/ lib/errors/ lib/validation/
  mocks/                       in-process mock backend (development and tests only)
tests/e2e/                     Playwright specs (one per feature, plus hardening)
openapi/openapi.json           the backend contract the types are generated from
scripts/                       API sync/check, bundle checks and report
docs/                          one guide per feature (see Guides)
```

## API client generation

Types come from the backend's OpenAPI document; nothing here invents endpoints (a test checks that every mock operation exists in the contract).

```bash
# backend running with SWAGGER_ENABLED=true
BACKEND_OPENAPI_URL=http://localhost:3000/api/docs-json npm run api:sync   # updates openapi/openapi.json
npm run api:generate                                                        # updates src/lib/api/generated/schema.d.ts
npm run typecheck && npm test                                               # drift shows up as type errors
```

`npm run api:check` fails if the generated file is not exactly what the committed spec produces. Where the spec leaves response bodies undescribed, hand-written Zod schemas in `src/lib/api/contract/index.ts` (marked `OPENAPI-GAP`) validate what the backend really returns. Details and the list of gaps: [docs/api-integration.md](docs/api-integration.md).

## Mock mode

`TC_API_MODE=mock` serves a typed, in-process fake of the backend (`src/mocks`) with the backend's real rules: permissions, validation, idempotency, append-only ledgers, reversals, cooldowns, paging. Each mock account has its own data, so parallel tests do not collide. Magic inputs reach rare states (rate limits, outages, stale consent version). Mock mode is rejected in production by configuration, and the mock code is **removed from production builds** at build time; `npm run check:bundle` fails if any mock data appears in the browser or server output. Accounts, tokens and magic values: [src/mocks/README.md](src/mocks/README.md).

## Authentication

Email and password sign-in through `/api/session/login`, a sealed HttpOnly cookie, silent refresh with single-use refresh tokens, absolute session lifetime, deactivation and "log out everywhere" handled consistently (the person lands on a clear session-ended page). New team members set their password at `/accept-invitation` with the one-time code they were given. Branch staff choose a branch for the shift. Full guide, limits and backend gaps: [docs/authentication.md](docs/authentication.md).

## Localization

English and Amharic under `/en` and `/am`. Typed dictionaries by feature (`src/lib/i18n/messages`), English fallback, a development warning for missing keys, and only the namespaces a page needs sent to the browser. A test enforces identical keys and placeholders in both languages, and another forbids hard-coded user-facing text. Ethiopian phone numbers, Gregorian dates in the Addis Ababa (or the business) time zone, digits 0-9. Text written by a business is shown as written, never machine-translated. Guide: [docs/localization.md](docs/localization.md).

## Roles and permissions

The frontend mirrors the backend's permission catalogue (`src/lib/auth/permissions.ts`) to build navigation and guard routes. Every area also needs an entry permission, and the account **kind** (merchant or platform) must match the area.

| Area / page                          | Needs                                       | Owner | Manager | Branch staff | Platform admin |
| ------------------------------------ | ------------------------------------------- | :---: | :-----: | :----------: | :------------: |
| Staff scanner, branch choice         | `stamp:create`                              |  yes  |   yes   |     yes      |       no       |
| Dashboard overview                   | `merchant:read`                             |  yes  |   yes   |      no      |       no       |
| Program, branches, team              | `program:read`, `branch:read`, `staff:read` |  yes  |   yes   |      no      |       no       |
| Customers, rewards                   | `customer:read`                             |  yes  |   yes   |      no      |       no       |
| Reversals, visit history             | `reversal:create`                           |  yes  |   yes   |      no      |       no       |
| Analytics                            | `analytics:read`                            |  yes  |   yes   |      no      |       no       |
| Audit history                        | `audit:read`                                |  yes  |   yes   |      no      |       no       |
| Operations (merchants, jobs, system) | `platform:manage` (platform account)        |  no   |   no    |      no      |      yes       |
| Operations audit                     | `platform:audit:read` (explicit grant)      |  no   |   no    |      no      |      yes       |

Managers can manage branch staff only; owners can manage everyone. Merchant users never see operations navigation, and platform administrators cannot open merchant pages. Tests: `permissions.test.ts`, `guards.test.ts`, `operations-access.test.ts` and the access matrix in `tests/e2e/auth.spec.ts`.

## Routes

Every route exists in `/en` and `/am`.

| Route                                                                  | Who                 | Purpose                                                                             |
| ---------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| `/`                                                                    | everyone            | Home                                                                                |
| `/join/[joinReference]`                                                | customers           | Enrollment, consent, wallet choice                                                  |
| `/card`, `/card/wallet`                                                | customers           | Web loyalty card, wallet selection                                                  |
| `/login`, `/accept-invitation`                                         | everyone            | Sign in; set a password from an invitation code                                     |
| `/denied`, `/session-expired`                                          | signed-in / expired | Plain explanations                                                                  |
| `/staff/scanner`, `/staff/branch`                                      | branch staff, above | Scan, stamp, redeem; choose the branch                                              |
| `/dashboard`                                                           | merchants           | Overview with the north-star metric                                                 |
| `/dashboard/program`                                                   | merchants           | Program builder, join QR and posters                                                |
| `/dashboard/branches`, `/dashboard/team`                               | merchants           | Branches; team, invitations, roles                                                  |
| `/dashboard/customers`, `/dashboard/rewards`                           | merchants           | Customer search and details; reward activity; reversals                             |
| `/dashboard/analytics`                                                 | merchants           | Retention and loyalty analytics                                                     |
| `/dashboard/audit`                                                     | merchants           | Audit history                                                                       |
| `/dashboard/fraud`, `/dashboard/privacy`                               | merchants           | Fraud flags, review and limits; retention and customer privacy tools                |
| `/dashboard/settings`                                                  | merchants           | Business details, support contact, program defaults                                 |
| `/dashboard/campaigns`                                                 | merchants           | Campaigns **preview** (the backend has no campaigns yet)                            |
| `/operations`, `/operations/merchants[/id]`                            | platform admins     | Overview; merchant list and detail                                                  |
| `/operations/wallet-health`, `/privacy`, `/audit`, `/system`, `/fraud` | platform admins     | Jobs and retry; privacy records; platform audit; service state; fraud (not offered) |

## Testing

| Layer                   | Tooling                           | What it covers                                                                                           |
| ----------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Unit and component      | Vitest, React Testing Library     | Rules, schemas, the real feature clients over the mock backend, every screen's states, permissions, i18n |
| Contract                | Vitest                            | Mock backend vs OpenAPI (`openapi-reconcile.test.ts`), generated types (`api:check`)                     |
| Accessibility           | Playwright + axe (WCAG 2.1 AA)    | Every route in both languages (`hardening.spec.ts`), plus per-feature checks                             |
| End to end              | Playwright (phone 360px, desktop) | Each feature journey, the access matrix, hardening                                                       |
| Production-build checks | Playwright against `next start`   | CSP and nonce, security headers, indexing, throttled network, reduced motion (`prod-security.spec.ts`)   |
| Build checks            | scripts                           | No mock data or server configuration in any bundle; size budgets                                         |

`npm test` is fast and needs nothing running. `npm run test:e2e` builds the production app (live mode, backend unreachable: public pages only) and also starts `next dev` with the mock backend for the signed-in journeys; it needs `npx playwright install chromium` once. Specs are registered per project in `playwright.config.ts`. The browser tests run against `next dev`, which occasionally fails its very first cold compile; a warm-up project compiles routes first and one local retry covers the rest. If it persists, rerun or move the checkout out of a synced folder such as OneDrive.

## Security

- **Tokens never reach scripts.** Sealed HttpOnly cookies hold the session, the customer card and the branch choice. `localStorage`, `sessionStorage` and IndexedDB are not used (lint forbids them; an e2e test checks they stay empty after sign-in).
- **Content-Security-Policy with a per-request nonce** (`src/proxy.ts`, `src/lib/security/csp.ts`): scripts run only with the request's nonce (`strict-dynamic`), no `unsafe-inline` or `unsafe-eval` in production, `frame-ancestors 'none'`, `object-src 'none'`, same-origin connections only. Zod runs in no-eval mode so the policy is never violated. The JSON API routes get `default-src 'none'`. Every page is therefore rendered per request.
- **CSRF**: state-changing requests need the app's custom header and a same-origin `Origin`; the cookie is SameSite.
- **Redirects**: `?next=` is validated to a same-site path before use (`redirects.test.ts`).
- **No secrets in public env**, none in logs: the API logger redacts credentials and personal data (`safe-log.test.ts`); backend error text is never shown to people.
- **Merchant-provided text** is rendered as text (React escaping), brand colours are validated to `#RRGGBB`, QR codes are generated from controlled values only (`merchant-text-safety.test.tsx`).
- **Privacy**: phone numbers are masked for people without full access (and masked again client-side as defence in depth); audit details pass a second filter that drops secrets, tokens, IP addresses and devices; no analytics or tracking scripts exist, so no customer information is ever sent to one.
- **Indexing**: signed-in areas, sign-in, cards and the API send `X-Robots-Tag: noindex` and are disallowed in `robots.txt`.
- **Headers**: `nosniff`, `X-Frame-Options: DENY`, strict referrer policy, restrictive permissions policy (camera for the scanner only), HSTS in production.
- **Mock code is absent from production builds**, checked after every build.

## Accessibility

WCAG 2.1 AA is checked by axe in a real browser, including colour contrast, on every route in English and Amharic. Native elements throughout: `<dialog>` (focus trap, Escape, focus returns to the opener), `<select>`, `<table>` with headers and captions. A skip link, visible focus rings, 44px touch targets, form labels and linked hints and errors, live regions for validation and results, `prefers-reduced-motion` support, and no sideways scrolling at 360px. Status never relies on colour alone. The scanner has a typed-code and phone-number alternative to the camera. Every chart is one labelled image whose description lists each value, prints each value, and has a table alternative. Icon-only controls carry labels in both languages (tested).

## Performance

Server Components by default; ~45 client JavaScript files totalling about 450 KB gzip across the whole app (budget enforced by `npm run report:bundle`); per-route-group `loading.tsx`; dashboard sections load independently with skeletons so navigation is never blocked by an expensive section; queries share cache keys (definitions, wallet) so moving between pages does not repeat requests; large lists are paged (customers, audit, staff, branches); self-hosted fonts split by Unicode range so Ethiopic downloads only with Amharic text; no remote images. A throttled-network test (400 kbps, 400 ms) keeps the sign-in page usable and its script small.

## Deployment

1. Build with real environment variables: `TC_API_MODE=live`, `TC_API_BASE_URL=https://api.example.org/api/v1`, a random `TC_SESSION_SECRET` (`openssl rand -base64 48`), `NEXT_PUBLIC_APP_URL=https://app.example.org`.
2. `npm ci && npm run check` (add `npm run test:e2e` in CI), then `npm run build` and `npm start` (or your platform's Next.js runtime). Needs Node.js 20.9+.
3. Put it behind TLS. The backend's `CORS_ORIGINS` is not needed by the browser (it only talks to this origin), but the backend must be reachable from the server.
4. Run behind a proxy that forwards `X-Forwarded-*` headers so origin checks see the public host; set the same public origin in `NEXT_PUBLIC_APP_URL`.
5. Smoke test: `/en` loads, `/en/login` signs in, `/en/operations/system` (as a platform admin) shows the service ready.

Production refuses to start with mock mode, a non-`https` backend URL or a placeholder secret. Changing `TC_SESSION_SECRET` signs everyone out.

## Troubleshooting

| Symptom                                               | Cause and fix                                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| App exits at start with "Invalid server environment"  | The message lists each bad variable. Set `TC_SESSION_SECRET` (32+ chars) and a valid `TC_API_BASE_URL`.               |
| Everyone is sent to the sign-in page                  | The session cookie cannot be read: `TC_SESSION_SECRET` changed, or the public origin does not match the address used. |
| Sign-in or any action answers 403 "Request refused"   | Origin check failed. Set `NEXT_PUBLIC_APP_URL` to the exact address people use (scheme, host, port).                  |
| Pages show English text in Amharic                    | A key is missing from `am.ts` (the dev console warns `[i18n] Missing`); the parity test fails in CI.                  |
| Scripts or styles blocked in the browser console      | A new inline script or style tag was added. Use framework features or external files; do not loosen the policy.       |
| Blank charts or numbers in dev                        | `TC_API_MODE` not `mock` and no backend running; check `.env.development.local`.                                      |
| `next build` runs out of date after dependency change | Delete `.next` and rebuild.                                                                                           |
| Playwright fails to start a web server                | Port 3001/3101/3102 in use, or a dev server is using `.next` while a build runs. Stop it and rerun.                   |
| First dev-server e2e test fails with JSON error       | Cold-compile flake (see Testing). Rerun; the warm-up project and one retry normally cover it.                         |
| `api:check` fails                                     | `openapi/openapi.json` changed without regenerating: run `npm run api:generate`.                                      |
| Camera does not start in the scanner                  | Needs HTTPS (or localhost) and permission; the typed code and phone lookup always work.                               |
| Wallet buttons look plain                             | Official Apple and Google artwork must be added by the business (see `public/wallet/README.md`).                      |

## Guides

| Topic                        | Guide                                                              |
| ---------------------------- | ------------------------------------------------------------------ |
| API integration              | [docs/api-integration.md](docs/api-integration.md)                 |
| Authentication               | [docs/authentication.md](docs/authentication.md)                   |
| Localization                 | [docs/localization.md](docs/localization.md)                       |
| Customer enrollment          | [docs/enrollment.md](docs/enrollment.md)                           |
| Wallet and web card          | [docs/customer-card.md](docs/customer-card.md)                     |
| Staff scanner                | [docs/scanner.md](docs/scanner.md)                                 |
| Merchant dashboard           | [docs/merchant-dashboard.md](docs/merchant-dashboard.md)           |
| Program builder, QR, posters | [docs/program-builder.md](docs/program-builder.md)                 |
| Branches and team            | [docs/branches-and-team.md](docs/branches-and-team.md)             |
| Customers, rewards, audit    | [docs/customers-rewards-audit.md](docs/customers-rewards-audit.md) |
| Analytics                    | [docs/analytics.md](docs/analytics.md)                             |
| Operations console           | [docs/operations-console.md](docs/operations-console.md)           |
| Production readiness         | [docs/production-readiness.md](docs/production-readiness.md)       |
| Mock backend                 | [src/mocks/README.md](src/mocks/README.md)                         |

## Design decisions

- **Cache Components are off.** Every page depends on the language and the signed-in session; they would need a `Suspense` boundary around nearly everything.
- **Own small i18n instead of a library.** Typed dictionaries, English fallback, namespaces sent per page.
- **Loading UI per route group**, not at the language root: a root `loading.tsx` starts streaming before `notFound()` can set the 404 status.
- **Every page is rendered per request**, because the Content-Security-Policy carries a fresh nonce that Next.js must stamp on each page's scripts.
- **Native elements over a UI framework**, for built-in keyboard and screen-reader behaviour.
