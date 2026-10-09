# Production readiness

The result of the final accessibility, performance, security and integration pass. It records what was checked, how to repeat it, what is still mocked, and what depends on the backend.

## What was verified, and where

| Check                      | Where it is proved                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route permissions          | `permissions.test.ts`, `guards.test.ts`, `operations-access.test.ts` (unit); the role/route access matrix and navigation tests in `auth.spec.ts`           |
| English and Amharic        | `parity.test.ts` (same keys and placeholders), `no-hardcoded-text.test.ts`, per-feature Amharic e2e tests, `hardening.spec.ts` axe sweep in both languages |
| Customer enrollment        | `enrollment.spec.ts` and the enrollment unit tests (consent, existing member, rate limits, outage, wallet choice)                                          |
| Wallet selection, web card | `card.spec.ts`, `web-card-view.test.tsx`, wallet button and link tests                                                                                     |
| Staff scanning             | `scanner.spec.ts`, `scanner-flow.test.ts`, `scanner-app.test.tsx` (camera, typed code, phone lookup, rejections, offline)                                  |
| Stamp confirmation         | scanner e2e and unit tests: one stamp however many times the button is tapped, idempotent retry after a lost answer                                        |
| Reward redemption          | scanner e2e and unit tests: separate reward action, already-redeemed handling                                                                              |
| Manager reversal           | `records.spec.ts` (full reversal through the screens) and `records-workspaces.test.tsx` (reason, typed word, refusals, same key on retry)                  |
| Merchant analytics         | `analytics.spec.ts`, `analytics-workspace.test.tsx`, `dashboard.spec.ts`                                                                                   |
| Operations access          | `operations.spec.ts`, `operations-access.test.ts`, `ops-data.test.ts` (every merchant-side account refused on every platform route)                        |
| Mock vs OpenAPI contract   | `openapi-reconcile.test.ts`: every mock route exists in `openapi/openapi.json`; `api:check` for the generated types                                        |
| No mock code in production | `npm run check:bundle` scans the browser **and** server build output after every build                                                                     |

## Accessibility

- axe (WCAG 2.0/2.1 A and AA, including colour contrast) runs in a real browser over **every route**, signed in as each kind of account, in **English and Amharic**, at phone width: merchant dashboard (10 pages), staff screens, operations (8 pages), public pages. No violations.
- Keyboard: the skip link is the first stop and moves the starting point to the main content; the sign-in form is completable by keyboard alone with a label on every input; a dialog traps focus, closes on Escape and returns focus to its opener.
- Errors: a failed sign-in is announced (`role="alert"`); field errors are linked to their field; results use polite live regions.
- Icon-only controls are named in both languages (tested on the team page in Amharic); `<html lang>` follows the page language; merchant-written text carries its own `lang`.
- Reduced motion: with `prefers-reduced-motion`, every transition and animation computes to ~0 and smooth scrolling is off (production build).
- Scanner alternatives: typed card code and phone-number lookup always work without a camera or permission.
- Charts: each is one labelled image with a description of every value, prints each value, and has a table alternative.
- Not covered by automation, so left for a manual pass with real assistive technology before launch: TalkBack and VoiceOver reading order on the scanner result screens, Amharic screen-reader pronunciation of numbers and dates, and high-contrast / forced-colours modes.

## Performance

- **Bundle**: `npm run report:bundle` prints client JavaScript by size (gzip) after a build and enforces budgets (total 600 KB, single chunk 100 KB). Current: about 450 KB total across the whole app and a largest chunk of about 72 KB (the React runtime). The sign-in page ships well under 350 KB of script on the wire (tested).
- **Slow networks**: a throttled-network test (400 kbps, 400 ms round trip) loads the sign-in page to interactive in well under 30 seconds on the phone profile.
- **Route-level loading**: every route group has a `loading.tsx`; dashboard sections load independently with skeletons, so a slow analytics query never blocks navigation or the page shell (tested with a delayed backend).
- **Duplicate requests**: unit tests assert each dashboard and analytics query is sent exactly once; the browser test caps repeats at the development server's Strict Mode double-mount and checks that moving between pages reuses cached data (definitions are cached for an hour).
- **Server vs client**: Server Components by default; Client Components only for interaction.
- **Large data sets** are paged: customers, audit, rewards activity, staff and branch analytics (cursor), merchants (in memory, the backend returns the list whole).
- **Images**: there are no remote images; the QR is inline SVG generated on the server; wallet button artwork is a static local file. `next/image` is configured with an empty remote allow-list.
- **Fonts** are self-hosted and split by Unicode range; the Ethiopic font only downloads with Amharic text.
- Every page is now rendered per request (the nonce policy requires it). The pages are small and mostly shells, but a CDN can no longer cache HTML; static assets remain immutable and cacheable.

## Security controls

See the Security section of the README. In short: sealed HttpOnly cookies and no browser storage; a nonce-based Content-Security-Policy with no inline-script or eval allowance in production (verified in a real production build on every public page, with Zod switched to its no-eval mode); origin-checked state-changing requests through an allow-listed proxy; validated redirects; redacting logger; backend error text never shown; merchant text rendered as text; masked phone numbers with a second client-side mask; filtered audit details; no tracking scripts; noindex headers plus `robots.txt`; mock code absent from production output.

## Remaining mocked operations

Everything is exercised against the in-process mock backend in development and tests, because no backend is run by this project's test suite. Every mock operation exists in the OpenAPI contract (checked), and shapes the contract leaves undescribed follow the backend source (`OPENAPI-GAP` in `src/lib/api/contract`). **The live HTTP path has not been exercised against a running backend in this environment**; before launch run the signed-in journeys against a staging backend with `TC_API_MODE=live`. The first things to check are the response shapes marked `OPENAPI-GAP` (analytics, audit, memberships and ledger, staff activity, cohorts, platform routes) and the exact validation message text used by forms.

Mocked in tests only (live in production): all of `auth`, `join`, `card`, `scanner`, `merchant/*` and `platform/*` that the screens use, plus `GET /health` and `/health/ready`.

## Backend operations in the contract that no screen uses

`POST /merchant/programs/{id}/…` lifecycle actions are used; these are not: merchant profile logo (`PUT/DELETE /merchant/profile/logo`, no storage behind it), the returning-customer detail list, the single-flag read (`GET /merchant/fraud/flags/{id}`) and indicator catalogue (`GET /merchant/fraud/indicators`, the screens use their own translated wording), and `POST /platform/users/{userId}/deactivate` (no way to find a user id). They are future screens, not gaps in what was built.

## Known limitations

- Campaigns is a **preview** on proposed operations that exist only in the mock backend (see [merchant-tools.md](merchant-tools.md)); in production it shows "not available yet". A logo cannot be uploaded because the backend has no file storage.
- No offline QR display for customers.
- Official Apple and Google wallet button artwork must be supplied by the business (`public/wallet/README.md`).
- Invitation links do not exist: the backend sends no email, so the inviter hands over a one-time code, which the invitee types at `/accept-invitation`.
- The operations console shows only what the platform routes provide (see [operations-console.md](operations-console.md)).
- Browser tests run the signed-in journeys on Chromium only (phone and desktop profiles); Safari and Firefox are untested.
- Inline `style` attributes are still allowed by the policy (`style-src-attr`), because brand colours and progress widths use them. They cannot execute code.

## Remaining backend dependencies

- Merchant onboarding, approval and status changes; per-merchant platform detail; platform-wide fraud and reversal views; a privacy-request queue (see the operations console guide).
- A way to list or search login accounts for platform administrators.
- Email (or another delivery) for invitations.
- A decision on database row-level security for tenant isolation (open with the product owner).
- Complete OpenAPI response bodies for the endpoints marked `OPENAPI-GAP`, so the Zod layer can shrink.
- Typed password and validation error codes (the screens currently rely on the 400 shape).
