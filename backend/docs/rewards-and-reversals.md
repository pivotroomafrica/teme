# Rewards, redemption and reversals

## The model: everything is derived from an append-only ledger

Three append-only ledgers (database triggers reject UPDATE, DELETE and TRUNCATE):

| Ledger              | Row means                        | Corrected by                           |
| ------------------- | -------------------------------- | -------------------------------------- |
| `stamp_events`      | one valid visit                  | a `reversal_events` row pointing at it |
| `reward_unlocks`    | "a card was completed" (history) | never changed                          |
| `redemption_events` | a reward was handed over         | a `reversal_events` row pointing at it |

Nothing about balances is stored. For one membership:

- **Effective stamps** = stamps without a reversal.
- **Progress** = `effective mod required` (and `floor(effective / required)` cards completed).
- **Rewards earned** `E = floor(effective / required)`.
- **Redeemed** = redemptions without a reversal. The system guarantees `redeemed ≤ E` at all times.

### Reward states (derived, never stored)

Unlock rows are classified by a pure function (`rewards/domain/reward-state.ts`, unit-tested and fuzz-tested):

1. A row with an active redemption is **REDEEMED**.
2. The remaining entitlement `E − redeemed` goes to the **earliest** unredeemed rows: **AVAILABLE**, or **EXPIRED** once
   `expires_at` has passed (expired rewards still count as earned).
3. Any further rows are **REVERSED**: reversals removed the stamps that backed them (newest rows are voided first).

A new unlock row is appended only when `E` exceeds the number of rows that already exist. So if a stamp is reversed and the
card is completed again, the original reward is back in force and **no second reward is created**; repeated cycles keep
producing one row per completed card. The result depends only on (stamps, redemptions, time), so replaying the ledger
always reproduces the same state.

## Redeeming (`/scanner`)

| Operation                      | Permission          | Notes                                                       |
| ------------------------------ | ------------------- | ----------------------------------------------------------- |
| `POST /scanner/rewards/lookup` | `redemption:create` | read-only; lists redeemable rewards, soonest-expiring first |
| `POST /scanner/redemptions`    | `redemption:create` | `Idempotency-Key` **required**; optional `rewardUnlockId`   |

- Same card/branch/permission checks as stamping: the staff member must be allowed to operate at an **active** branch.
  Another merchant's card is `INVALID_TOKEN`; unknown, foreign, unassigned and inactive branches are
  `BRANCH_NOT_PERMITTED`.
- Without `rewardUnlockId`, the **soonest-expiring** available reward is redeemed. An explicit id must be AVAILABLE,
  otherwise `REWARD_NOT_AVAILABLE` (expired, redeemed, voided, unknown or another card's: indistinguishable).
  Nothing to redeem → `NO_REWARD_AVAILABLE`.
- **Concurrency**: the membership row is locked, the available set is recomputed under the lock, and a unique index
  `(reward_unlock_id, attempt_number)` is the database guarantee. Two devices redeeming at once: one `REDEEMED`, the other
  `NO_REWARD_AVAILABLE`/`REWARD_NOT_AVAILABLE`. `attempt_number` is 1 for the first redemption of an unlock and 2+ only
  after an earlier one was reversed.
- **Earned rewards are honoured** while the program is `PAUSED` or `ARCHIVED` (stamping is not). A deactivated membership
  cannot redeem (`MEMBERSHIP_INACTIVE`).
- Idempotent like stamping: a retry returns the original outcome (`replayed: true`); reusing a key for a different
  request is `422 IDEMPOTENCY_KEY_REUSED`.
- In the redemption's transaction: the event, wallet passes flagged stale, a `wallet.pass_update` outbox job
  (`reward_redeemed`), the `reward.redeemed` audit event and the stored response. Rejected attempts are audited as
  `redemption.rejected`.

## Reversals (`/merchant`, owners and authorised managers)

| Operation                                          | Permission        |
| -------------------------------------------------- | ----------------- |
| `POST /merchant/stamps/:stampId/reverse`           | `reversal:create` |
| `POST /merchant/redemptions/:redemptionId/reverse` | `reversal:create` |
| `GET /merchant/memberships/:id/ledger`             | `reversal:create` |
| `GET /merchant/memberships/:id/rewards`            | `customer:read`   |

- `reversal:create` is held by OWNER and MANAGER (a permission in the catalogue, so a merchant's manager role can be
  taken away from it centrally). Branch staff and platform administrators get 403; another merchant's ids get 404.
- Body `{ "reason": "…" }`: **mandatory**, 3–500 characters, control characters stripped. `Idempotency-Key` required.
- A reversal **appends a `reversal_events` row**; the original is untouched (tests compare the row before and after).
  Database checks guarantee one target, a reason, one reversal per event, and that the reversal belongs to the same
  membership as its target.
- Each stamp/redemption can be reversed **once** (`409 ALREADY_REVERSED`, including under concurrent attempts).
- **Reward protection**: reversing a stamp is refused with `409 REWARD_ALREADY_REDEEMED` if it would leave more rewards
  redeemed than earned. Reverse the redemption first. Reversing a redemption makes the reward AVAILABLE again (if still
  backed and unexpired).
- Cooldown: a reversed stamp no longer blocks a new scan.
- Each reversal runs under the membership lock together with scans and redemptions, flags wallet passes stale, queues a
  `wallet.pass_update` job (`stamp_reversed` / `redemption_reversed`) and writes `stamp.reversed` / `redemption.reversed`
  audit events. **The free-text reason is stored with the reversal only, never in the audit log**, because it can contain
  personal details.
- The ledger endpoint returns newest-first stamps, redemptions and reversals (with reasons) and the derived summary; it is
  capped at 200 entries per type.

## What staff cannot do

There are no update or delete endpoints for stamps, unlocks, redemptions or reversals (404), no endpoint that sets a total,
and the database rejects any UPDATE/DELETE/TRUNCATE on the ledgers even from application code.

## Wallet notifications

Unlock (`reward_unlocked`), redemption (`reward_redeemed`) and both reversal kinds enqueue a `wallet.pass_update` outbox job
in the same transaction as the change. Delivery, retries and dead letters are described in [wallet-passes.md](wallet-passes.md).
