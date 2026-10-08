# Recommended contract for the future `/frontend` (Next.js)

The frontend is a separate application that only talks to this REST API. Nothing here is implemented in `/backend`; it is the agreed shape so the frontend can be built against the OpenAPI document (`GET /api/docs-json` when `SWAGGER_ENABLED=true`, or generate a typed client from it).

## Surfaces

| Surface                                       | Users                          | Routes (suggested)     | API areas                                                            |
| --------------------------------------------- | ------------------------------ | ---------------------- | -------------------------------------------------------------------- |
| Customer join and card (mobile web, no login) | customers                      | `/join/[ref]`, `/card` | `GET/POST /join/{ref}`, `/card/*`, `/wallet/apple/download/{serial}` |
| Staff scanner (mobile web / PWA)              | branch staff, managers, owners | `/scan`                | `/auth/*`, `POST /scanner/*`, `GET /merchant/branches`               |
| Merchant dashboard                            | owners, managers               | `/dashboard/*`         | `/merchant/*`                                                        |
| Platform console                              | TemelashCard operators         | `/platform/*`          | `/platform/*`                                                        |

Language: English (`en`) and Amharic (`am`). Every user-facing field has an `…Am` twin (nullable; fall back to English). Scanner results carry both `message.en` and `message.am`. Use `Intl` with the merchant's `timezone` (from `GET /merchant/profile`) for display; the API always sends UTC ISO-8601.

## Conventions

- Base URL `https://<api>/api/v1`. JSON only. Send `Content-Type: application/json`.
- **Auth**: `POST /auth/login {email,password}` → `{accessToken, refreshToken, expiresIn, user}`. Send `Authorization: Bearer <accessToken>`. The access token lives 15 minutes; call `POST /auth/refresh {refreshToken}` shortly before expiry or on a `401`, and **replace the stored refresh token with the one returned** (each is single use; reusing one signs the device out). Keep the access token in memory; keep the refresh token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie set by a Next.js route handler/BFF (the API itself does not set cookies), never in `localStorage`. `POST /auth/logout {refreshToken}` on sign-out. `GET /auth/me` returns `role`, `permissions` and `branchScope` (`"ALL"` or branch ids): drive UI visibility from permissions, never from the role name; the server enforces regardless.
- **Errors**: `{ "error": { "code", "message", "details?", "requestId", "timestamp" } }`. Switch on `code` (`VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, plus specific ones such as `COOLDOWN_ACTIVE`, `REWARDS_OUTSTANDING`, `PROGRAM_LOCKED`). Show `message` for validation, and `requestId` in a "contact support" detail. `404` also means "not yours".
- **Pagination**: list endpoints return `{ items, nextCursor }`; pass `?limit=` (≤100) and `?cursor=<nextCursor>`. Never construct cursors.
- **Idempotency**: scanner writes (`/scanner/stamps`, `/scanner/redemptions`) and reversals need an `Idempotency-Key` header: generate a UUID **per user action** and reuse it on every retry of that action (network failure, timeout) so a flaky connection can never double-stamp. A response with `replayed: true` is the original outcome.
- **Dates**: ranges accept `YYYY-MM-DD` (merchant-local days, `to` inclusive) or ISO timestamps; months are `YYYY-MM`.
- **Request id**: log the `X-Request-Id` response header with client errors.
- **Rate limits**: handle `429` with a short back-off; login is stricter.
- **CORS**: the API allows the origins in `CORS_ORIGINS`; call it from the browser or, preferably, through Next.js server code.

## Screen-to-endpoint map

**Customer**

- Join page: `GET /join/{ref}` (merchant, program, reward, terms, wallet options, consent version) → form → `POST /join/{ref}/enroll {phone, firstName, preferredLanguage, acceptTerms: true, marketingConsent?, consentVersion}`. The response contains `card.token` **once**: render it as a QR code and keep it on the device (the customer's only credential).
- Card page: `POST /card/web {cardToken}` (progress, rewards, QR), `POST /card/wallet/links {cardToken, provider}` (Add to Apple/Google Wallet), `POST /card/consent/marketing/withdraw {cardToken}`.

**Scanner**

- Sign-in, then choose the branch from `GET /merchant/branches` (branch staff only see assigned ones). Camera → decode QR → `POST /scanner/validate {cardToken, branchId}` (optional pre-check) → `POST /scanner/stamps` (with `Idempotency-Key`). Render `outcome`, `message.{en,am}`, `customer.firstName`, `progress`, `reward.unlocked`. Rejections are normal `200` responses (`COOLDOWN_ACTIVE` includes `retryAfterSeconds`).
- Reward desk: `POST /scanner/rewards/lookup {cardToken}` then `POST /scanner/redemptions` (with key).
- Staff can search customers (`GET /merchant/customers?q=`) – phones are masked for branch staff.

**Dashboard (owner/manager; each section is permission-gated)**

- Overview and north-star: `GET /merchant/analytics/overview`, `/monthly-returning-customers`, details `/returning-customers`, `/branches`, `/staff`, `/cohorts`, `/wallet`, definitions for tooltips `/definitions`.
- Customers: `/merchant/customers`, `/merchant/customers/{id}`, `/merchant/memberships/{id}/ledger|rewards|wallet-passes`, reissue card, deactivate/reactivate, reverse stamp/redemption (reason required).
- Programs: `/merchant/programs` (+ activate/pause/archive); respect `stampsRequiredLocked`.
- Branches and staff: `/merchant/branches`, `/merchant/staff` (+ invite, role, branches, activate/deactivate, activity). The invitation token is shown once to the inviter; the invitee opens a page that calls `POST /auth/invitations/accept {token,password}`.
- Business profile: `/merchant/profile` (+ logo).
- Trust and compliance (owners): `/merchant/audit` (filters: date, actor, branch, action), `/merchant/fraud/*` (flags, review, thresholds), `/merchant/customers/{id}/data|export|anonymize`, `/merchant/privacy/retention`.

**Platform console**: `/platform/merchants`, `/platform/audit`, `/platform/outbox/stats|dead` (+ requeue), `/platform/users/{id}/deactivate`.

## Frontend security and quality requirements

- Never log or persist card tokens, access tokens or phone numbers beyond what the screen needs; no analytics SDK on scanner or card pages.
- Send a strict CSP; the API already sends `nosniff`, HSTS and `no-store`.
- Hide, don't merely disable, actions the user lacks permission for, but treat every `403` as a possible permission change and refresh `/auth/me`.
- Scanner UX: debounce the camera, disable the button while a request is in flight, reuse the same idempotency key on automatic retry, and show Amharic first for Amharic users.
- Generate API types from `/api/docs-json` in CI and fail the build when they drift.
- Accessibility and low-bandwidth: server-render the join and card pages, keep them light, and support offline display of the last card QR.
