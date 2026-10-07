# Staff scanner and stamp engine

Two operations, both under `/api/v1/scanner`, both requiring a merchant access token with `stamp:create`
(owner, manager, branch staff). The merchant always comes from the token. Platform administrators get 403.

| Operation                | Purpose                               | Writes?                                              | Idempotency-Key |
| ------------------------ | ------------------------------------- | ---------------------------------------------------- | --------------- |
| `POST /scanner/validate` | "Can this card be stamped right now?" | nothing                                              | not needed      |
| `POST /scanner/stamps`   | Add exactly one stamp                 | stamp, unlock, outbox job, audit, idempotency record | **required**    |

## What the scanner sends

```json
POST /api/v1/scanner/stamps
Authorization: Bearer <access token>
Idempotency-Key: 3f1c9d4e-…            // one fresh key per scan attempt
{ "cardToken": "<opaque QR value>", "branchId": "<uuid>", "device": { "platform": "android", "appVersion": "1.4.2", "deviceId": "install-7f3a" } }
```

- **`cardToken`** is the opaque value in the QR code / wallet barcode: 256 random bits, no personal data, only its SHA-256
  hash is stored. It is never logged (request logging redacts `cardToken` and the idempotency key) and never appears in
  audit metadata.
- **`branchId`** is the branch the device is operating at. Optional only for accounts assigned to exactly one branch.
  It is a claim that is checked against the account's assigned, active branches.
- **`device`** keeps only whitelisted, non-identifying facts (`platform`, `appVersion`, an opaque `deviceId`). Unknown
  fields are rejected; there is no field for amounts, prices or customer data.

## The confirmation sequence

Everything below runs in **one database transaction**:

1. Authenticate; guards require `stamp:create`.
2. **Replay lookup**: if this staff member already used this key, return the stored answer (see below). _(This runs before
   the other checks, unlike the prompt's step 7, because a replay must not be judged against the cooldown that its own
   original stamp created.)_
3. Resolve the branch: it must be assigned to the staff member and active.
4. Look up the card **within this merchant** and **row-lock the membership** (`SELECT … FOR UPDATE`). Scans of one card
   now run one after another.
5. Look again for a stored answer (a concurrent retry may have committed while we waited for the lock).
6. Membership `ACTIVE`; program `ACTIVE` (the program row is share-locked so a pause cannot interleave).
7. Cooldown against the latest stamp that is **not reversed**, on the database clock.
8. Insert one append-only `stamp_events` row (merchant, branch, staff, membership, program, device metadata, time).
9. Recount effective stamps → progress; if this stamp completes a card, insert a `reward_unlocks` row.
10. Flag wallet passes stale and insert a `wallet.pass_update` **outbox** job.
11. Write audit events (`stamp.issued`, `reward.unlocked`, or `scan.rejected`).
12. Store the response under the idempotency key. Commit.

If anything fails, **nothing** is committed: no stamp, no unlock, no outbox row, no stored key — and the client can
retry with the same key. Unexpected errors are reported as a generic `500 INTERNAL_ERROR` with the request id; database
and security details are only in the server log.

## Results

Rejections are ordinary `200` results so a scanner UI can display them; protocol problems (bad body, missing key,
`401`, `403`, `422`) use the standard error envelope.

```json
{
  "outcome": "STAMPED",
  "reason": null,
  "message": { "en": "Stamp added.", "am": "ስታምፕ ተጨምሯል።" },
  "customer": { "firstName": "Abebe" },
  "stamp": { "id": "…", "occurredAt": "2026-10-09T08:30:00.000Z" },
  "progress": {
    "current": 2,
    "required": 8,
    "remaining": 6,
    "completedCards": 0,
    "rewardsAvailable": 0
  },
  "reward": { "unlocked": false },
  "replayed": false
}
```

`outcome` is `STAMPED`, `ELIGIBLE` (validate) or `REJECTED` with one of these safe `reason`s:

| reason                 | meaning                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `BRANCH_NOT_PERMITTED` | unknown, other-tenant, unassigned **or** inactive branch (indistinguishable)               |
| `INVALID_TOKEN`        | not a card of this merchant (malformed, unknown, or another merchant's: indistinguishable) |
| `MEMBERSHIP_INACTIVE`  | customer membership deactivated                                                            |
| `PROGRAM_INACTIVE`     | program is draft, paused or archived                                                       |
| `COOLDOWN_ACTIVE`      | too soon; includes `retryAfterSeconds`, customer first name and progress                   |

Every rejection carries English and Amharic text (`message.en` / `message.am`). The Amharic wording should be reviewed by
a native speaker. Cooldown rejections recorded by confirm feed the fraud indicators later.

## Idempotency

- A retry with the same key returns the **original outcome** (including rejections) with `"replayed": true` and an
  `Idempotent-Replay: true` header; it adds no stamp, no job, no audit row.
- Keys are scoped to the staff member and operation. Using a key again for a **different card or branch** is
  `422 IDEMPOTENCY_KEY_REUSED`.
- Ten simultaneous requests with one key produce one stamp: the membership lock serialises them and the second lookup
  returns the first answer. A unique index `(staff_membership_id, operation, key)` and `stamp_events (staff_membership_id,
idempotency_key)` are the final backstop.
- Records live `IDEMPOTENCY_TTL_HOURS` (default 48); a cleanup job will purge them. They contain the customer's first
  name as shown on the scanner.

## Cooldown

Effective cooldown = max(program cooldown, `SCANNER_MIN_INTERVAL_SECONDS`, default 10). The built-in guard stops an
accidental double scan even when a program has no cooldown. Wait times are rounded up so clients never retry early. A
**reversed** stamp (Prompt 7) neither blocks scans nor counts toward progress.

## Progress and rewards

Nothing is stored or editable: progress is `effective stamps mod required`, cards completed is `floor(effective /
required)`. Staff have no endpoint that sets, edits or deletes a total, and the ledger tables reject UPDATE/DELETE.
Completing a card inserts a `reward_unlocks` row keyed by the triggering stamp (unique), so concurrent scans cannot
create a duplicate reward. Repeated cycles keep producing rewards; expiry follows the reward's `validForDays`.
Redemption and reversals: [rewards-and-reversals.md](rewards-and-reversals.md). Reward rows are appended only when entitlement outgrows the existing rows, so reversing a stamp and re-earning the card never creates a second reward.

## Wallet updates

The outbox job `wallet.pass_update` (payload: reason and stamp id only) commits with the stamp. A provider outage later
can never roll a valid stamp back; delivery, retries and dead letters are in [wallet-passes.md](wallet-passes.md). The scanner also accepts a wallet pass's own barcode (while that pass is ACTIVE) in place of the card token.
