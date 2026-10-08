# Mock backend

An in-process fake of the NestJS backend for development and tests. Enable it with `TC_API_MODE=mock` (never allowed in production). It implements the same `Transport` interface as the live HTTP client, so feature services run their real code against it; see `docs/api-integration.md`.

Everything is made-up sample data. State (stamp counts, idempotency records, refresh tokens) lives in memory per server process and resets on restart.

## Sign in (password for all: `mock-password-1`)

| Email               | Role                                | Notes                              |
| ------------------- | ----------------------------------- | ---------------------------------- |
| `owner@mock.test`   | Merchant owner                      | all merchant permissions           |
| `manager@mock.test` | Merchant manager                    | no privacy/fraud management        |
| `staff@mock.test`   | Branch staff                        | assigned to **both** branches      |
| `viewer@mock.test`  | Read-only manager (test account)    | all `:read`, nothing `:manage`     |
| `admin@mock.test`   | TemelashCard platform administrator | `platform:*` only                  |
| `busy@mock.test`    | (any password)                      | answers 429 with `Retry-After: 30` |

Any other email, or a wrong password, answers the same 401 `INVALID_CREDENTIALS`.

## Join links (`/join/[joinReference]`)

| Reference     | Behaviour                                         |
| ------------- | ------------------------------------------------- |
| `sample-cafe` | works                                             |
| `busy`        | 429 rate limited (`Retry-After: 20`)              |
| `down`        | 503 unavailable                                   |
| anything else | 404 (unknown, suspended and paused look the same) |

## Enrollment form

- Phone numbers ending in `0000`, and any number already enrolled in this process, answer `EXISTING` (no card token).
- Invalid phone, empty name, `acceptTerms: false` answer 400 with field messages.
- A `consentVersion` other than `2026-10-v1` answers 409 `CONSENT_VERSION_STALE`.
- New members get a card token like `mock-ok-1-4567` and start with 0 stamps.

## Card tokens (scanner and customer card)

| Token              | State                                               |
| ------------------ | --------------------------------------------------- |
| `mock-ok-*`        | active card with 2 of 8 stamps (new enrollments: 0) |
| `mock-almost*`     | 7 of 8: the next stamp unlocks a reward             |
| `mock-reward*`     | reward available (8 stamps, 1 reward)               |
| `mock-cooldown*`   | stamping refused, `COOLDOWN_ACTIVE`, wait 120 s     |
| `mock-inactive*`   | membership suspended, `MEMBERSHIP_INACTIVE`         |
| `mock-redeemed`    | card completed and the reward already redeemed      |
| `mock-invalidated` | membership invalidated (web card shows it)          |
| `mock-pending`     | membership still being prepared                     |
| `mock-flaky-*`     | web card loads twice, then answers 503              |
| `mock-down`        | web card request answers 503                        |
| anything else      | not a card of this merchant, `INVALID_TOKEN` / 404  |

Wallet links: `WEB` always works; `APPLE`/`GOOGLE` answer 409 `PROVIDER_NOT_AVAILABLE` unless the token contains `apple` / `google` (for example `mock-ok-google`).

Branch ids: the two sample branches are in `fixtures.ts` (`MOCK_BRANCHES`). A branch id that is not one of them, or one the account is not assigned to, answers `BRANCH_NOT_PERMITTED`.

## Idempotency

Stamp and redemption requests need an `Idempotency-Key`. The same key with the same card returns the original result with `replayed: true`; the same key with a different card or reward answers 422 `IDEMPOTENCY_KEY_REUSED`.

## Assumptions to reconcile with the live backend

Marked `ASSUMPTIONS` in `handlers.ts`: rejection message wording, the exact validation detail strings, and the retry-after values. The shapes themselves are checked against the contract schemas in `src/lib/api/contract`.

## Programs

Every mock account has its **own** loyalty programs (one active default, "Coffee Card", 12 members, stamp count locked), so tests that create, publish or archive programs never affect another account's data. The rules follow the backend: the same limits, `PROGRAM_LOCKED`, `PROGRAM_ARCHIVED`, `DEFAULT_PROGRAM_EXISTS`, `PROGRAM_INCOMPLETE`, `INVALID_TRANSITION`.
