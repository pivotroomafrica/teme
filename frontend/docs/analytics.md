# Analytics and retention reporting (`/[locale]/dashboard/analytics`)

Needs `analytics:read` (owners and managers); the server turns everyone else away, and the page also says so if it is reached without it. Code: `src/features/analytics`, with the range control and section pieces shared from `src/features/dashboard`.

## What the page shows

Order matters. The **north star** (Monthly Returning Loyalty Customers) is the one emphasised number and has its own trend chart. Everything else is supporting detail in plain cards and tables, so the page stays calm.

| Section           | Metrics (all from the backend)                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| North star        | Monthly Returning Loyalty Customers for the current month and the 6, 12 or 24 months before it (the current month is marked "so far")                                                                                                             |
| This period       | New members, active members, stamps issued (and how many were later reversed), rewards unlocked, rewards redeemed, redemption rate, average visits per active member, time between visits (average, median, 90th percentile, number of intervals) |
| Branch comparison | Stamps, unique customers and redemptions per branch: chart + table, "Show more" through the backend's cursor                                                                                                                                      |
| Staff activity    | Stamps, reversed stamps, reversal rate, unique customers, redemptions per team member, most stamps first, "Show more"                                                                                                                             |
| Retention cohorts | Share of each join-month's members who visited again in each following month (month 0 is the joining month)                                                                                                                                       |
| Wallet            | Adoption by provider (a snapshot of today), update success rate and counts for the period                                                                                                                                                         |

## Rules

- **The browser does not calculate metrics.** It chooses dates and months, formats numbers and dates for the language, and lays things out. Ratios the backend reports as `null` (nothing to divide by) are shown as a dash, never as 0%. The backend's own definitions are under "What do these numbers mean?".
- **Dates are the business's calendar days.** The page reads `?range=last7|last30|last90|thisMonth|lastMonth` or `?from=…&to=…` (YYYY-MM-DD) from the address, shows the time zone it uses, and refuses a range the backend would refuse (invalid, start after end, over 366 days) before asking. "Today" is decided on the server in the business time zone so the first paint matches.
- **Each section loads and fails alone.** A failing section shows its own explanation and retry, a warning says some information is missing, and the rest stays. Retrying one section does not re-request the others.
- **Charts are never the only way to read a number.** Each chart is one labelled image whose description lists every value, every bar prints its value, and a button reveals the same numbers as a real table. Unfinished months are drawn hatched (pattern, not only colour).
- **Empty data is explained**: an empty period, no visits in the trend, no branch or staff activity, no new members, no active cards, and not enough return visits to measure.
- **No money.** The backend has no revenue, sales, purchase, billing or payment analytics, and none is shown or asked for (a test scans the page).
- **No export.** The backend has no export endpoint, so the page offers none and says so.

## Backend gaps and notes

- Branch and staff lists are paged by the backend; the page asks 10 at a time.
- The returning-customers detail list (`/analytics/returning-customers`) exists but is not used: the brief asks for the number, not a list of people.
- The staff table shows a deactivated person's history, marked as deactivated.
- Response bodies are not described in the OpenAPI document (`OPENAPI-GAP` in the contract layer).
- Figures for past periods can change slightly if staff reverse stamps later (documented by the backend).

## Testing

Unit: `analytics-workspace.test.tsx` (date ranges from the address, presets, refused ranges, time zone note; unchanged backend numbers and dashes for null ratios; cohorts; staff paging; empty data in every section; partial failure and per-section retry; no permission; chart descriptions and table alternatives; Amharic) and `analytics-staff-cohorts.test.ts` (the mock backend's rules). End to end (`tests/e2e/analytics.spec.ts`): the full page, period changes and an empty period, charts and tables, layout and accessibility, Amharic, and a restricted account.
