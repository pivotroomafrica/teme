# Audit, fraud indicators and privacy

Everything here is scoped to one merchant (derived from the signed-in staff membership, never from the request), uses UTC timestamps and UUIDs, and holds no payment, revenue or order-value data.

## Audit history

Every sensitive action appends one row to `audit_events` (a database trigger forbids updates and deletes). A row records **who** (user or system), **where** (merchant, branch), **what** (`action`, e.g. `staff.role_changed`), **on what** (`targetType`/`targetId`), **when**, the **request id** (same as the `X-Request-Id` response header) and small, sanitized **metadata**. The writer drops anything that looks like a secret (passwords, tokens, hashes, keys, authorization headers) and anything personal such as phone numbers or e-mail addresses; free text is not accepted.

| Endpoint                     | Permission                    | Notes                                                                                                                                                                                             |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/merchant/audit` | `audit:read` (owner, manager) | Own merchant only. Owners also see IP/user-agent metadata; managers do not.                                                                                                                       |
| `GET /api/v1/platform/audit` | `platform:audit:read`         | Explicit grant, `platform:manage` is not enough. Without `merchantId`: platform-level events only. Naming a merchant is itself recorded in that merchant's audit log (`audit.platform_accessed`). |

Filters: `from`, `to` (a date such as `2026-10-01` is read in the **merchant's time zone** and includes the whole local day; an ISO timestamp is exclusive at the end), `actorUserId`, `branchId`, `action`, `actionPrefix` (e.g. `stamp.`), `targetType`, `targetId`. Maximum span 366 days (default: last 30). Newest first, cursor-paginated (`limit` 1-100, `cursor` from `nextCursor`).

## Fraud indicators

Indicators only **flag** things for a person to look at. Nothing is blocked, suspended or reported automatically, and customers are never penalised.

| Indicator                       | Subject      | Default threshold                                                       |
| ------------------------------- | ------------ | ----------------------------------------------------------------------- |
| `EXCESSIVE_STAMPS_BY_STAFF`     | staff member | more than 40 stamps in 60 min                                           |
| `REPEATED_SCANS_FOR_MEMBERSHIP` | card         | more than 6 scans (accepted or refused) in 60 min                       |
| `UNUSUAL_BRANCH_ACTIVITY`       | branch       | at least 20 stamps and 4x the branch's own 7-day average for the window |
| `HIGH_REVERSAL_RATE`            | staff member | over 20% of at least 20 stamps reversed within 7 days                   |
| `REPEATED_COOLDOWN_REJECTIONS`  | card         | more than 5 cooldown refusals in 60 min                                 |
| `EXCESSIVE_REDEMPTIONS`         | staff member | more than 5 rewards handed out in 24 h                                  |

- Thresholds are configurable per merchant (`GET/PUT /merchant/fraud/settings`, owner to change, owner and manager to read). Updates are partial, range-validated (bad values are rejected with 400), and each indicator can be switched off. A stored value that is invalid is ignored in favour of the default, so monitoring cannot be disabled by corrupt data. The audit entry lists only the _names_ of changed fields.
- Evaluation runs every `FRAUD_EVALUATION_INTERVAL_MINUTES` (default 15) through the outbox worker (one job per merchant per interval, so several instances do not duplicate work) and on demand via `POST /merchant/fraud/evaluate`. It uses set-based SQL aggregates, not per-event loops.
- A flag's identity is (merchant, indicator, subject, UTC-aligned window). Re-evaluating the same window updates the same row; a reviewed flag is not reopened.
- Flags contain ids, counts and the threshold, never personal data. Owners record a verdict once (`POST /merchant/fraud/flags/{id}/review`, `DISMISSED` or `CONFIRMED`, optional short note kept with the flag but not in the audit log).

## Privacy

All of the following require `privacy:manage` (owners only) except deactivation, which needs `customer:manage` (owners and managers).

- **View stored data**: `GET /merchant/customers/{id}/data`. Profile, consent history, memberships, wallet passes, stamps, redemptions, reversals and reward unlocks.
- **Export**: `GET /merchant/customers/{id}/export`. Same content as a JSON attachment (`Cache-Control: no-store`). It leaves out staff identities, token hashes, barcodes and device tokens. Both calls are audited (`customer.data_viewed`, `customer.data_exported`) with the customer id but no data.
- **Withdraw marketing consent**: `POST /merchant/customers/{id}/consents/marketing/withdraw` appends a `WITHDRAWN` row; the history remains.
- **Deactivate a loyalty membership**: `POST /merchant/memberships/{id}/deactivate` and `/reactivate`. The card stops working at the counter immediately and its wallet passes are refreshed. History and personal data are kept. Both are idempotent.
- **Anonymize**: `POST /merchant/customers/{id}/anonymize` with `reason` (`CUSTOMER_REQUEST`, `RETENTION_POLICY`, `LEGAL_OBLIGATION`, `OTHER`). Irreversible. In one transaction (after locking the customer's memberships, so no stamp can slip in) it clears name and phone number, marks every membership inactive with a fresh random token hash, revokes wallet passes and Apple device registrations, and deletes cached scanner answers that might quote the customer. If the customer still has an unclaimed reward the call returns `409 REWARDS_OUTSTANDING` unless the body has `acknowledgeOutstandingRewards: true`. Repeating the call is a harmless no-op. The phone number becomes free for a new sign-up.
- **What is kept, and why**: stamps, redemptions, reversals, reward unlocks, consent history and the audit trail. They identify people only by internal id, so after anonymization they hold no personal data, and they are needed to account for rewards already given and to investigate abuse. We chose anonymization over hard deletion so that append-only ledgers (enforced by database triggers) stay intact.

### Retention

`GET/PUT /merchant/privacy/retention` sets `inactiveCustomerMonths`: customers with no stamp or redemption for that long are anonymized automatically. `0` turns it off; otherwise 6-120 (default 36). Customers holding an unclaimed reward are skipped, never forfeited by a background job. `POST /merchant/privacy/retention/run` applies it now (up to 200 customers per call; `more` says whether to call again). The scheduled run (`RETENTION_INTERVAL_HOURS`, default 24) creates one outbox job per merchant per interval and also a platform-wide clean-up:

| Data                                  | Removed after                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Expired scanner (idempotency) answers | 24 h past expiry                                                                                                   |
| Revoked or expired refresh tokens     | 30 days                                                                                                            |
| Completed outbox jobs                 | 30 days (dead jobs stay until an operator handles them)                                                            |
| Audit events                          | never by the application (append-only); they contain no personal data. Archival policy is an operational decision. |

## Tests

`test/e2e/audit.e2e-spec.ts`, `fraud.e2e-spec.ts` and `privacy.e2e-spec.ts` cover permissions (owner/manager/staff/anonymous/other tenant), tenant isolation, filters and pagination, deduplication, thresholds, review, deactivation, anonymization side effects, retention and clean-up. Pure rules are unit tested in `src/modules/fraud/domain`, `src/modules/audit/domain`, `src/modules/privacy/domain` and `src/common/time`.
