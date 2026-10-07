# Wallet passes (Apple Wallet, Google Wallet, web card)

The backend runs **without any Apple or Google credentials**. `WALLET_MODE=fake` (the default) swaps both providers for
in-memory fakes, which is what local development and every automated test use. Real credentials are only needed in
`WALLET_MODE=live`, and only for the providers you switch on.

## Architecture

```
stamp / redemption / reversal  ──(same DB transaction)──▶  outbox_jobs  +  wallet_passes flagged stale
                                                                  │  (committed; the loyalty event is safe)
                                                  OutboxWorker (polls, claims with SKIP LOCKED)
                                                                  ▼
                                              WalletSyncHandler → WalletService.syncMembership
                                                                  ▼
                         WalletProviderAdapter  ─ AppleWalletAdapter / GoogleWalletAdapter / WebWalletAdapter
                                                    (or FakeWalletAdapter in fake mode)
```

- `WalletProviderAdapter` is the provider-neutral contract: `createPass`, `addLink`, `updatePass` (progress **and** reward
  status), `suspendPass` (suspend / invalidate). Apple additionally renders passes on demand.
- A pass is built from a neutral `PassState` that is **rebuilt from the ledger at delivery time**, so a retried or
  coalesced update always carries the latest numbers, never a stale queued value.
- **A provider failure can never roll back a loyalty event**: delivery happens after commit, in the worker.
- `wallet_passes` records provider ids and delivery state: `provider_pass_id`, `pass_version` (bumped on every change),
  `last_synced_version`, `sync_status` (`PENDING`/`SYNCED`/`FAILED`), `last_synced_at`, and a scrubbed `last_error`.

### Outbox worker (retries and dead letters)

- Claims due jobs with `FOR UPDATE SKIP LOCKED`, so many instances can run safely; a job whose worker died (PROCESSING
  for > 5 minutes) is reclaimed.
- Failure → retry with exponential backoff (30 s, 1 m, 2 m … capped at 1 h, ±20 % jitter). After `max_attempts` (default 8)
  or on a permanent error (`PermanentJobError`, an Apple/Google rejection that retrying cannot fix) the job becomes
  **DEAD** and is never retried automatically.
- Error text stored with a job is scrubbed of keys, bearer tokens and long opaque strings.
- Platform administrators: `GET /platform/outbox/stats`, `GET /platform/outbox/dead`,
  `POST /platform/outbox/dead/:id/requeue` (audited).
- Settings: `OUTBOX_WORKER_ENABLED`, `OUTBOX_POLL_INTERVAL_MS`, `OUTBOX_BATCH_SIZE`. The handler is idempotent, so
  duplicate delivery is harmless.

### Pass credentials (derived, not stored)

Each Apple/Google pass has its own **opaque barcode**, derived as `HMAC-SHA256(WALLET_BARCODE_SECRET, passId, version)`.
Only its SHA-256 is stored (`wallet_passes.barcode_hash`). Consequences:

- The server can regenerate any pass at any time (Apple pulls the file again on every update), with nothing sensitive stored.
- The scanner accepts a pass barcode exactly like a card token **while that pass is `ACTIVE`**; it counts against the same
  cooldown, totals and rewards.
- A pass can be **revoked on its own** (lost phone) without touching the customer's card token or web card.
- Apple's per-pass `authenticationToken` and the short-lived download link token are derived from the same secret with
  separate domain prefixes. Rotating `WALLET_BARCODE_SECRET` invalidates every issued wallet barcode; treat it like a
  signing key.

Revocation is terminal: `POST /merchant/memberships/:id/wallet-passes/invalidate` marks the Apple/Google passes
`INVALIDATED`, stops accepting their barcodes immediately, and tells the wallets to void them. A replacement is a **new
row with a new serial number**, so an old phone cannot pull a refreshed, valid pass (one live pass per provider is
enforced by a partial unique index).

## Customer API

| Call                                            | Purpose                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /card/wallet/links {cardToken, provider}` | Creates the pass on first use and returns an Add-to-Wallet link (`APPLE`: short-lived signed download; `GOOGLE`: signed "Save to Google Wallet" link; `WEB`: none). |
| `POST /card/web {cardToken}`                    | Live web card: progress, rewards, bilingual texts, QR value.                                                                                                        |

Authorised by possession of the card token and covered by the public enrollment rate limit. Unknown or inactive cards give
one identical 404; a wallet that is not switched on gives `409 PROVIDER_NOT_AVAILABLE`; a provider outage gives a safe
`502 WALLET_PROVIDER_UNAVAILABLE` and leaves the pass `PENDING`, to be finished by the next attempt or the worker.

## Staff API

`GET /merchant/memberships/:id/wallet-passes` (`customer:read`: delivery status), `POST …/wallet-passes/invalidate` and
`POST /merchant/wallet-passes/:id/resync` (`customer:manage`). Deactivating a customer's membership turns their wallet cards
into **suspended** state at the next delivery.

## Apple Wallet

**What the code does**

- Builds and signs the `.pkpass` (store-card style, QR barcode, progress strip drawn from data, English + Amharic
  `.lproj` labels; values follow the customer's language). Suspended/invalidated passes are `voided` with no barcode.
- Implements Apple's web service under `/api/v1/wallet/apple/v1/…` (device register/unregister, changed serials,
  latest pass with `If-Modified-Since`/304, device log). Every call is checked against the pass's own
  `Authorization: ApplePass <token>`.
- Sends the push-triggered refresh (empty APNs push over HTTP/2 with the pass certificate) to registered devices and forgets
  dead tokens (410 / BadDeviceToken). A failed push is retried by the outbox.
- Validates at startup (only if `WALLET_APPLE_ENABLED=true` in live mode): files exist, are PEM, the certificate is in date, the
  key matches the certificate, the passphrase is right. Errors name the setting, never its contents.

**What you must obtain (no secrets in this repo)**

1. Apple Developer Program membership.
2. In _Certificates, Identifiers & Profiles_: create a **Pass Type ID** (e.g. `pass.com.yourcompany.temelashcard`) and a
   **Pass Type ID certificate** from a CSR you generate.
3. Export the certificate and its private key, and download Apple's **WWDR** intermediate certificate. Convert all to PEM
   (`openssl x509 -inform der -in pass.cer -out pass-cert.pem`; `openssl pkcs12 -in pass.p12 -nodes -out …` to split a `.p12`).
4. Store the three PEM files **outside the repository** (secret manager / mounted volume) and point the settings at them.
5. Serve the API over **HTTPS** at a public URL (`WALLET_PUBLIC_BASE_URL`); iOS will not call plain HTTP.
6. Set `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_PASS_CERT_PATH`, `APPLE_PASS_KEY_PATH` (+ `APPLE_PASS_KEY_PASSPHRASE`),
   `APPLE_WWDR_CERT_PATH`, `WALLET_BARCODE_SECRET`, `WALLET_MODE=live`, `WALLET_APPLE_ENABLED=true`.
7. Test on a real iPhone: add the pass, stamp the card, and watch it refresh. Pass certificates expire yearly: calendar the renewal.

## Google Wallet

**What the code does**

- One **loyalty class per merchant program** (created on first use, kept in sync) and one **loyalty object per membership
  pass**; objects are updated by REST after every stamp, redemption and reversal. Suspended → `INACTIVE`, invalidated →
  `EXPIRED` with a void barcode. Texts carry Amharic translations.
- "Add to Google Wallet" links are RS256 JWTs signed with the service-account key that **reference** the object we created
  (they cannot be used to add anything we did not issue).
- **Demo vs production**: `GOOGLE_WALLET_ENV=demo` creates classes as `DRAFT` (only Console test users can add them);
  `production` submits them `UNDER_REVIEW`.
- Authenticates with the OAuth 2.0 JWT-bearer grant; the key only signs the assertion and never appears in logs, errors or
  responses. Outages/429/5xx are retryable; 4xx rejections and bad sign-in are permanent (dead-lettered, not hammered).

**What you must obtain**

1. A Google Pay & Wallet **Console** account and an **Issuer ID** (numeric).
2. A Google Cloud project with the **Google Wallet API** enabled and a **service account**; add it as a user of the issuer in the
   Console; download its JSON key and store it **outside the repository**.
3. Add test users in the Console for demo mode. For production, submit the issuer for **approval** (brand/logo review).
4. Host a public **HTTPS logo** (`GOOGLE_WALLET_DEFAULT_LOGO_URL`; per-merchant logos arrive with file storage).
5. Set `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_PATH`, `GOOGLE_WALLET_ORIGINS`, `GOOGLE_WALLET_ENV`,
   `WALLET_BARCODE_SECRET`, `WALLET_MODE=live`, `WALLET_GOOGLE_ENABLED=true`.

## Configuration rules

`src/config/env.schema.ts` enforces: a barcode secret whenever a provider is enabled; Apple/Google credentials **only for
the enabled provider and only in live mode**; HTTPS public URL in live mode; **fake adapters are refused in production**.
Fake-mode behaviour can be scripted in tests with `FakeWalletBackend` (`failNext`, `failAlways`, call log).

## Testing without credentials

- Unit: the real Apple signer is exercised with certificates generated on the fly (PKCS#7 signature and manifest verified
  independently); the APNs client runs against a local HTTP/2 server; the Google client runs against a local stand-in for
  Google's OAuth and Wallet endpoints.
- E2E (`wallet.e2e-spec.ts`): fake providers, outbox delivery, retries, dead letters, Apple web service, revocation.
- E2E (`wallet-live.e2e-spec.ts`): live mode with generated credentials, downloading a genuinely signed `.pkpass` over HTTP.

## Known limitations

- Per-merchant logos are not used yet (file storage): Google uses one default logo; Apple draws an icon from the brand colour.
- The Google class is cached per process; a changed program colour/name reaches Google when the process restarts or the class
  is recreated.
- Apple device-log lines are only scrubbed and logged at warn level.
- Real Apple/Google sign-off (a real iPhone, Console approval) cannot be automated here and is on the launch checklist.
