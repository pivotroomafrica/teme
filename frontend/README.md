# TemelashCard Frontend

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · English and Amharic.
This is the foundation: routing, layouts, configuration, i18n, design tokens and test tooling. Business screens arrive in later steps. The backend lives in `../backend` and is never modified from here.

> Next.js 16 differs from earlier versions (for example `middleware` is now `proxy`). Read the bundled docs in `node_modules/next/dist/docs/` before changing framework-level code.

## Run it

```bash
cd frontend
npm install
cp .env.example .env.development.local     # then set TC_SESSION_SECRET (32+ random characters)
npm run dev                                 # http://localhost:3001
```

| Task                      | Command                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Dev server                | `npm run dev`                                                                                                   |
| Production build / serve  | `npm run build` then `npm start`                                                                                |
| Unit and component tests  | `npm test` (Vitest, React Testing Library)                                                                      |
| End-to-end and a11y tests | `npm run test:e2e` (Playwright; builds and serves the app itself; first run: `npx playwright install chromium`) |
| Format / lint / types     | `npm run format:check` · `npm run lint` · `npm run typecheck`                                                   |
| API types                 | `npm run api:sync` (download the spec) · `npm run api:generate` · `npm run api:check`                           |
| Browser-bundle leak check | `npm run check:bundle` (after a build)                                                                          |
| Everything                | `npm run check`                                                                                                 |

## Environment variables

Validated by Zod (`src/lib/config/env.ts`); the app refuses to start on invalid values. Files named `.env*` are git-ignored except `.env.example`.

Server variables carry a `TC_` prefix on purpose: generic names such as `API_MODE` or `API_TIMEOUT_MS` collide with variables that hosting platforms and developer tools already define (this happened during development).

| Variable                  | Where       | Purpose                                                                    |
| ------------------------- | ----------- | -------------------------------------------------------------------------- |
| `TC_API_BASE_URL`         | server only | Backend base URL including `/api/v1`. Must be `https` in production.       |
| `TC_API_MODE`             | server only | `live` or `mock`. `mock` is rejected in production.                        |
| `TC_SESSION_SECRET`       | server only | Seals the session cookie (32+ chars). Placeholders rejected in production. |
| `TC_API_TIMEOUT_MS`       | server only | Backend request timeout (default 10000).                                   |
| `TC_SESSION_MAX_AGE_DAYS` | server only | Absolute session lifetime in days (default 30).                            |
| `NEXT_PUBLIC_APP_URL`     | public      | Public origin of this site (canonical URLs, origin checks).                |

Anything prefixed `NEXT_PUBLIC_` is shipped to every browser, so secrets must never use that prefix (a test and a start-up check enforce this). Backend secrets and wallet-provider private keys never belong in this project.

Environments: development uses `.env.development.local`, tests set their variables in `vitest`/`playwright` configuration, production uses real environment variables from your platform.

## Structure

```
src/
  app/[locale]/        every route lives under /en or /am
    (public)/          customer pages: home, join/[joinReference], card
    (auth)/            login
    (staff)/           staff/scanner
    (merchant)/        dashboard
    (operations)/      operations
    error.tsx  not-found.tsx  [...rest]/   localized error and 404 pages
  app/global-error.tsx static bilingual fallback for root-layout failures
  proxy.ts             language routing + noindex headers (optimistic only)
  features/            business features (empty until their step)
  components/ui        reusable controls (design-system step)
  components/layout    shells for each surface, language switcher, state views
  lib/{api,auth,errors,validation}   reserved for the integration steps
  lib/config           validated environment
  lib/i18n             dictionaries, translator, locale resolution
  hooks/  mocks/  styles/tokens.css  design tokens
tests/{e2e,integration,stubs}
```

Rules: Server Components by default; Client Components only for interaction; components never call the network (an ESLint rule enforces it); `localStorage`/`sessionStorage` are forbidden by lint so tokens cannot be stored in script-readable storage.

## API integration

Typed client generated from the backend OpenAPI document, a transport with timeouts/cancellation/safe retries (never for stamping, redemption or reversal), one normalized `ApiError`, and an in-process mock backend (`TC_API_MODE=mock`, sign-ins and card tokens in `src/mocks/README.md`). Full guide, the list of OpenAPI gaps and how to regenerate: [docs/api-integration.md](docs/api-integration.md).

## Authentication

Sealed HttpOnly session cookie, backend-for-frontend routes under `/api/session` and `/api/bff`, role-aware shells for staff, merchant and operations. Details, limits and backend gaps: [docs/authentication.md](docs/authentication.md).

## Localization

English and Amharic under `/en` and `/am`, typed dictionaries by feature, Ethiopian phone and date formatting. Guide: [docs/localization.md](docs/localization.md).

## Customer enrollment

Public join journey at `/{locale}/join/{reference}`: server-rendered business summary, minimal form, separate consents, existing-member and unavailable states, wallet choice. Guide and safety decisions: [docs/enrollment.md](docs/enrollment.md).

## Wallet and web card

The customer card is kept in a sealed HttpOnly cookie (never browser storage); wallet selection suits the phone; the web card shows progress, reward and a server-generated QR. Guide, security notes and backend gaps: [docs/customer-card.md](docs/customer-card.md). Optional `NEXT_PUBLIC_SUPPORT_URL` adds a support link.

## Staff scanner

Camera or typed card code, backend-decided eligibility, separate stamp and reward actions, idempotent writes with deliberate retries, no offline stamping. Guide, safety rules and backend gaps: [docs/scanner.md](docs/scanner.md).

## Merchant dashboard

Permission-aware shell and the overview page: backend-defined metrics, date ranges in the business time zone, independent sections with their own loading and error states, accessible charts with table alternatives, and no money anywhere. Guide and backend gaps: [docs/merchant-dashboard.md](docs/merchant-dashboard.md).

## Program builder and QR materials

Create, edit, publish, pause and archive a loyalty program with live join-page, web-card and wallet-card previews, member-impact warnings and unsaved-change protection; plus the join QR and printable posters in English, Amharic or both. Guide and backend gaps: [docs/program-builder.md](docs/program-builder.md).

## Branches and team

Branch and team management with permission-aware actions, one-time invitation codes, role and branch changes, activate and deactivate, safe recent activity, and tables that become cards on phones. Guide and backend gaps: [docs/branches-and-team.md](docs/branches-and-team.md).

## Design system

Shared components live in `src/components/ui` (import from `@/components/ui`); tokens are in `src/styles/tokens.css`. Built from native elements (`<dialog>`, `<select>`, checkboxes) rather than a UI framework. Components never call the network and take all text from props or the `ui` dictionary namespace.

Preview gallery (development only, absent from production builds): run `npm run dev` and open `/en/dev/design-system` or `/am/dev/design-system`.

Guarantees checked by tests: WCAG 2.1 AA (axe, including colour contrast in a real browser), 44px touch targets, visible focus rings, reduced-motion support, no horizontal overflow or clipping with long Amharic text at 360px width, keyboard behaviour of tabs, menus and dialogs. Status never relies on colour alone (each tone has its own icon shape and a spoken label). Red is used only for destructive actions, invalid scans and fraud warnings.

## Decisions

- **Cache Components are off.** The template enables them, but every page here depends on the language and, later, on the signed-in session; Cache Components would require a `Suspense` boundary around nearly everything. Revisit after the dashboard exists.
- **Own small i18n instead of a library.** Typed dictionaries per feature, English fallback, a development warning for missing keys, and only the needed namespaces sent to the browser.
- **Loading UI per route group**, not at the language root: a root `loading.tsx` starts streaming before `notFound()` can set the 404 status.
- **Fonts are self-hosted** (`@fontsource-variable`), split by Unicode range, so the Ethiopic font downloads only when Amharic text is on the page and builds work offline.
- **Security headers** are set in `next.config.ts`. The CSP is strict except for inline scripts, which Next.js needs; the nonce-based policy comes in the hardening step.

## Planned integration (next steps)

Authentication uses a backend-for-frontend: Next route handlers keep the backend access and refresh tokens in a sealed, HttpOnly, SameSite=Strict cookie, so browser JavaScript never sees a token. API types will be generated from the backend OpenAPI document. The backend gaps found during planning (stamp by customer, campaigns, merchant onboarding, platform-wide fraud/privacy views, typed responses for 34 operations) are tracked in the project report.

## Known test-environment note

The design-system browser tests run against `next dev`. The Next.js dev server occasionally fails its very first cold compile ("Unexpected end of JSON input"), more often when the project sits in a synced folder such as OneDrive. A warm-up project compiles the routes first and Playwright retries once locally; if it persists, rerun or move the checkout out of the synced folder.
