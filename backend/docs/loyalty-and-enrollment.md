# Loyalty programs, customer enrollment and consent

Everything is under `/api/v1`. Merchant routes need a merchant access token and take the merchant only from it.
Public routes (`/join/*`, `/card/*`) need no login. Interactive docs: `/api/docs`.

## Programs (`/merchant/programs`)

| Operation                              | Permission       | Roles                        |
| -------------------------------------- | ---------------- | ---------------------------- |
| List / view                            | `program:read`   | owner, manager, branch staff |
| Create, edit, activate, pause, archive | `program:manage` | owner, manager               |

A program is stamp-based: `stampsRequired` (1–1000), `cooldownMinutes` (0–10080), English and Amharic `name`/`terms`,
`brandColor` (`#RRGGBB`), wallet-card `cardDisplay` (`title`, `subtitle`, `stampIcon`, `showProgressText`), and exactly
one active **reward** (English and Amharic name and description, optional `validForDays` expiry). Nothing financial is
stored: unknown fields such as `price` or `cashValue` are rejected.

Omitted stamp count and cooldown default to the merchant's program defaults (`/merchant/profile`).

### Lifecycle

```
DRAFT ──activate──▶ ACTIVE ◀──activate── PAUSED
                       └────pause────────▶
any non-archived state ──archive──▶ ARCHIVED   (terminal)
```

- Transitions are idempotent (repeating one returns the program and writes no audit row); impossible ones answer
  `409 INVALID_TRANSITION`.
- **One default ACTIVE program per merchant (MVP).** Activating a second one answers `409 DEFAULT_PROGRAM_EXISTS`; pause or
  archive the first. Enforced by a lock on the merchant's programs **and** a partial unique index.
- Activation requires an active reward (`409 PROGRAM_INCOMPLETE`).
- **Only ACTIVE programs accept new customers.** Pausing keeps every membership and all history.
- There is no delete. Archiving keeps memberships, rewards and the ledger; archived programs cannot be edited
  (`409 PROGRAM_ARCHIVED`).

### Protection against corrupting active memberships

Member progress is derived from the stamp ledger and the program threshold, so:

- `stampsRequired` is **locked once any customer has joined** (`409 PROGRAM_LOCKED`). Create a new program instead.
  Enrollment takes a shared row lock on the program and edits take the exclusive lock, so a sign-up and a threshold change
  cannot interleave.
- Names, terms, colour, card display, cooldown and reward text can always be edited (until archived). Cooldown and reward
  expiry apply to future stamps and unlocks only.
- Responses include `memberCount` and `stampsRequiredLocked` so a UI can explain this up front.

Audit: `program.created`, `program.updated` (field names only), `program.activated`, `program.paused`, `program.archived`.

## Customer enrollment (public)

**`GET /join/:joinReference`** returns what a join page shows: merchant name (EN/AM), the active program and reward,
terms, brand colour, wallet options and the current consent version. No internal ids, no contact data. An unknown
reference, a suspended merchant, and a merchant without an ACTIVE default program all give the identical `404`.

**`POST /join/:joinReference/enroll`** `{phone, firstName, preferredLanguage, acceptTerms: true, marketingConsent?, consentVersion?}`

1. The phone is normalised to E.164 (`0911…`, `+251 91…`, `251…`, `00251…` are all the same number); non-Ethiopian
   numbers are rejected.
2. The customer is found or created **inside this merchant only**; the membership is created in the merchant's
   active default program; a web-card wallet pass is created.
3. Consent is recorded (see below).
4. Response: `status`, the submitted name/language echoed back, program info, wallet options, and
   `card.token` — the opaque value for the QR code / wallet barcode, **returned once** and stored only as a SHA-256 hash.

Wallet options: `WEB` is always available; `APPLE` and `GOOGLE` report `available: false, reason: NOT_CONFIGURED` until
those providers are enabled (`WALLET_APPLE_ENABLED`, `WALLET_GOOGLE_ENABLED`; see [wallet-passes.md](wallet-passes.md)).

### Duplicate enrollment and privacy

- Repeating an enrollment is safe: `status: "EXISTING"`, **no new card, nothing changed**. Simultaneous requests for the
  same number create exactly one customer and one membership.
- An existing customer's stored name, language and consent can **never** be changed through the public form (a third
  party who knows a number must not be able to edit or opt-in/out someone else). The response echoes what the caller
  submitted instead of stored data.
- **Nothing is ever revealed about other merchants.** A number known only to merchant B is indistinguishable, at merchant
  A, from a brand-new number (same status, same fields). The same phone at two merchants is two unrelated customer rows.
- Trade-off: within one merchant, `CREATED` vs `EXISTING` tells a caller whether a number is already a member of that
  merchant. This is limited by the per-IP enrollment rate limit (`ENROLL_RATE_LIMIT_MAX`, default 10/min). Account
  recovery without a one-time code is deliberately not offered: staff use `POST /merchant/memberships/:id/reissue-card`.
  Phone verification by SMS/OTP is the recommended next hardening when a provider is chosen.

### Consent (append-only ledger)

`customer_consents` stores one row per decision: type (`LOYALTY_TERMS`, `MARKETING`), action (`GRANTED`, `WITHDRAWN`),
**version**, **source** (`JOIN_FORM`, `STAFF_ASSISTED`, `PRIVACY_REQUEST`) and a UTC **timestamp**. Current state is the
latest row per type. `acceptTerms` must be `true`; marketing is opt-in and defaults to off. If `consentVersion` is sent
and is not current, the request fails with `409 CONSENT_VERSION_STALE` so the customer always agrees to the text they saw.

Withdrawing marketing consent only appends a `WITHDRAWN` row. The customer, membership, card and history stay:

- customer self-service: `POST /card/consent/marketing/withdraw {cardToken}` (possession of the card is the credential);
- merchant: `POST /merchant/customers/:id/consents/marketing/withdraw` (`customer:manage`).
  Both are idempotent and audited (`customer.marketing_consent_withdrawn`).

## Customer search (`GET /merchant/customers`)

`customer:read` (owner, manager, branch staff), always scoped to the caller's merchant, newest first, keyset-paginated
(`limit` ≤ 100, opaque `cursor`). `q` is interpreted as:

- a **complete phone number** in any format → exact match on the normalised number;
- **4+ digits** → partial number match (owners and managers only);
- otherwise a **first-name fragment** (2+ characters, case-insensitive, Amharic included).

SQL wildcard characters are stripped, so `%` cannot list everyone. Branch staff see **masked phone numbers**
(`+2519*****567`) and must type a complete number to find someone; users with `customer:manage` see full numbers and
consent state. Anonymized customers never appear. Unknown query parameters (e.g. `merchantId`) are rejected with 400.

Performance note: phone lookups use the `(merchant_id, phone_e164)` unique index and listing uses
`(merchant_id, created_at DESC, id DESC)`; name and partial-phone fragments scan within one merchant. A trigram index
can be added if a merchant grows to hundreds of thousands of customers.

## Lost or compromised cards

`POST /merchant/memberships/:id/reissue-card` (`customer:manage`) issues a replacement token (shown once), invalidates
the old one immediately, flags wallet passes for refresh (`pass_version + 1`, sync `PENDING`) and audits
`membership.card_reissued`.
