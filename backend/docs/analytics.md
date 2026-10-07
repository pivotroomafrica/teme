# Loyalty analytics

Everything lives under `GET /api/v1/merchant/analytics/*` and needs `analytics:read` (owners and managers). The merchant always comes from the signed-in staff membership; no parameter can select another tenant. The API reports **loyalty activity only**: there are no revenue, transaction-amount, average-order-value, payment or billing metrics anywhere (an integration test scans the responses for such fields), and no such data is stored.

The live definitions are served by `GET /merchant/analytics/definitions` and come from `src/modules/analytics/domain/metric-definitions.ts`.

## Dates and time zones

- `from` / `to` accept a calendar date (`2026-10-01`) or an ISO 8601 timestamp. Dates are read in the **merchant's configured IANA time zone** (default `Africa/Addis_Ababa`, UTC+3).
- `from` is inclusive. A bare-date `to` includes that whole local day; a timestamp `to` is exclusive. Internally every range is `[from, to)` in UTC.
- Default range: the last 30 days. Maximum: 366 days. Invalid ranges return `400`.
- Months (north-star, cohorts) are local calendar months. In Addis Ababa March 2026 is `2026-02-28T21:00:00Z` up to (not including) `2026-03-31T21:00:00Z`; a stamp at 23:59:59.999 local on 31 March counts in March and one at 00:00:00.000 on 1 April in April. The boundary tests in `test/e2e/analytics.e2e-spec.ts` pin this down, including a second run of the same data in UTC.
- The response always echoes the resolved `range` (UTC instants) and `timeZone`.

## Metric definitions

A **qualifying visit** is one stamp with no reversal, judged as of now. Redemptions are not visits. A stamp reversed later disappears from every period, including past ones, so figures for past periods can change slightly if staff correct history.

| Metric                                               | Definition                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New members                                          | Memberships (customer joins a program) whose join time is in the range.                                                                                                                                                                                                                      |
| Active members                                       | Unique customers with at least one qualifying visit in the range (a customer in two programs counts once).                                                                                                                                                                                   |
| Returning loyalty customers                          | Active members who also had a qualifying visit before the range started.                                                                                                                                                                                                                     |
| **Monthly Returning Loyalty Customers** (north-star) | Unique customers with a qualifying visit in the selected local month who also had one before that month began. Same rule as above with the range set to the month. `returningShare` = returning / active for context. The current month is flagged `partial`.                                |
| Stamps issued                                        | Qualifying visits in the range; `reversed` counts stamps given in the range that were later reversed.                                                                                                                                                                                        |
| Rewards unlocked                                     | Unlocks in the range whose triggering stamp has not been reversed.                                                                                                                                                                                                                           |
| Rewards redeemed                                     | Redemptions in the range that have not been reversed.                                                                                                                                                                                                                                        |
| Redemption rate                                      | redeemed / unlocked within the range. A period ratio, can exceed 1; `null` if nothing unlocked.                                                                                                                                                                                              |
| Average visits per active member                     | stamps / active members; `null` if none.                                                                                                                                                                                                                                                     |
| Time between visits                                  | For each qualifying visit in the range that is not the first on its card: hours since the previous qualifying visit on the same card (which may be before the range). Average, median and 90th percentile; `intervals` is the sample size.                                                   |
| Branch activity                                      | Per branch: qualifying visits, unique customers, non-reversed redemptions. Every branch is listed, including inactive ones with zeros.                                                                                                                                                       |
| Staff stamping activity                              | Per staff member: qualifying visits, stamps later reversed, `reversalRate` = reversed / (visits + reversed), unique customers, redemptions handled.                                                                                                                                          |
| Program retention cohorts                            | Memberships grouped by local join month. Retention at month _k_ = share of the cohort with a qualifying visit in the calendar month _k_ months after joining (month 0 = joining month). Up to 24 cohorts and 12 follow-up months; months that have not happened yet are not shown.           |
| Wallet provider adoption                             | Snapshot: active memberships holding an active pass from each provider ÷ all active memberships. Every card has a web pass, so WEB is expected near 100%. Also lists non-web pass sync states.                                                                                               |
| Wallet update success rate                           | Of pass-update outbox jobs created in the range that have finished, the share that succeeded (the others exhausted their retries). Queued/retrying jobs are listed as `stillQueued` and excluded from the rate; `succeededAfterRetry` shows resilience. Attempt-level history is not stored. |

Ratios are rounded to four decimals and are `null` (never `0` or `NaN`) when the denominator is zero.

## Endpoints

| Endpoint                                              | Purpose                                                                                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /merchant/analytics/overview`                    | Headline metrics for a range (`from`, `to`, `programId`).                                                                    |
| `GET /merchant/analytics/monthly-returning-customers` | North-star for `month` (default current) plus the `months` before it (1-24, default 6).                                      |
| `GET /merchant/analytics/returning-customers`         | Paginated detail: the customers behind "returning" (first name, visits in range, last and previous visit; no phone numbers). |
| `GET /merchant/analytics/branches`                    | Paginated branch activity, busiest first.                                                                                    |
| `GET /merchant/analytics/staff`                       | Paginated staff activity, most stamps first.                                                                                 |
| `GET /merchant/analytics/cohorts`                     | Retention cohorts (`cohorts` 1-24, `programId`).                                                                             |
| `GET /merchant/analytics/wallet`                      | Wallet adoption and update success.                                                                                          |
| `GET /merchant/analytics/definitions`                 | The table above, machine-readable.                                                                                           |

Detail views use **keyset pagination** (`limit` 1-100, default 25, opaque `cursor` from `nextCursor`; a malformed cursor is a `400`), so deep pages cost the same as the first and results do not shift while paging.

## Performance

All aggregation is done by PostgreSQL with set-based queries, nothing is aggregated in application memory, and every statement starts with `merchant_id = …`. They use these indexes (checked by `test/integration/schema.int-spec.ts`):

| Query                               | Index                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| Stamps by period / unique customers | `stamp_events (merchant_id, occurred_at)`                                                       |
| Per card, gaps and "visited before" | `stamp_events (merchant_id, membership_id, occurred_at)`                                        |
| Branch / staff activity             | `stamp_events (merchant_id, branch_id                                                           | staff_membership_id, occurred_at)` |
| "Not reversed" test                 | unique `reversal_events (stamp_event_id)` / `(redemption_event_id)`                             |
| Redemptions by period               | `redemption_events (merchant_id, occurred_at)`                                                  |
| New members, cohorts                | `customer_memberships (merchant_id, joined_at)` _(added in `20261010100000_analytics_indexes`)_ |
| Rewards unlocked                    | `reward_unlocks (merchant_id, unlocked_at)` _(added)_                                           |
| Wallet update jobs                  | `outbox_jobs (merchant_id, type, created_at)` _(added)_                                         |

There is no separate analytics database and no summary table yet. The "time between visits" and cohort queries are the heaviest (they look at history before the range for the cards that were active). **Measure before optimising:** if p95 latency for a large merchant exceeds roughly one second, the first step is a nightly per-merchant, per-day rollup table (`stamps`, `unique customers`, `redemptions`) fed from the ledger, which the overview and north-star can read; the ledger remains the source of truth.
