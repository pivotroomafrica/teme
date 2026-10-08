# Merchant dashboard: shell and overview (`/[locale]/dashboard`)

## The shell

Built in the authentication step and used here unchanged: a header (business, who is signed in, branch, language, account menu) and a navigation list that contains **only the pages the account may open**. The server builds the list from the permission rules (`src/lib/auth/permissions.ts`); the browser draws what it is given and decides nothing. Hiding a link is a convenience, not security: every dashboard page repeats the exact permission check on the server.

- Wide screens (tablet and up): side list next to the content.
- Phones: the list folds behind a **Menu** button.
- Every page title, label and message is in the dictionaries (English and Amharic).

The other nine dashboard routes (`program`, `branches`, `team`, `customers`, `rewards`, `campaigns`, `analytics`, `audit`, `settings`) still show the protected placeholder; they arrive in the next steps.

## The overview

One page, six independent sections. **Each section has its own request, so a slow or failing section never blocks the others** (partial data is a normal state, with a banner and a per-section retry).

| Section                                                                                                                             | Backend                                               | Needs            |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------- |
| Monthly Returning Loyalty Customers (north-star) and its 6-month chart                                                              | `GET /merchant/analytics/monthly-returning-customers` | `analytics:read` |
| New members, active members, stamps issued (with how many were later reversed), rewards unlocked, rewards redeemed, redemption rate | `GET /merchant/analytics/overview?from&to`            | `analytics:read` |
| Branch activity                                                                                                                     | `GET /merchant/analytics/branches?from&to`            | `analytics:read` |
| Wallet update health                                                                                                                | `GET /merchant/analytics/wallet?from&to`              | `analytics:read` |
| Recent operational events                                                                                                           | `GET /merchant/audit?limit=8`                         | `audit:read`     |
| "What do these numbers mean?"                                                                                                       | `GET /merchant/analytics/definitions`                 | `analytics:read` |

Without a permission the page makes none of that section's requests and says so in words.

### Nothing is calculated here

The browser never adds up, averages, compares or classifies a figure. It chooses the dates, asks, and shows the answer, formatted for the language. In particular:

- **Redemption rate** is the backend's ratio shown as a percentage. It may be above 100% (the backend defines it as redeemed over unlocked in the same period) and it is `null` when nothing was unlocked: shown as a dash with that explanation, **never as 0%**.
- **Wallet health** shows the backend's counts and success rate. It does not grade them ("healthy", "poor"): that would be a threshold invented in the browser. A note appears only when the backend reports updates that failed after all retries.
- The north-star carries the backend's `partial` flag: the current month says it is not over yet and its bar is hatched.
- The definitions panel prints the backend's own wording.

### Not shown

No revenue, sales, order value, payment data, billing or subscriptions anywhere on the page (the backend has none; a unit test and an end-to-end test scan the page text for such words).

### Dates and time zone

- Periods: last 7 / 30 / 90 days, this month, last month, or two chosen dates. The choice lives in the address (`?range=last7`, `?from=…&to=…`), so it survives a reload and can be shared. The default (last 30 days) keeps the address clean; anything unreadable in the address falls back to the default.
- Dates are **calendar days in the business time zone** (`GET /merchant/profile` → `timezone`, default `Africa/Addis_Ababa`), the same reading the backend uses (`to` includes that whole day). "Today" is worked out in that zone on the server, so the first render and the browser agree; event times are shown in that zone; the page states the zone.
- The browser checks a range the backend would refuse (not a real date, start after end, more than 366 days) and explains it before anything is sent.

### Charts

The bar chart prints every value on its bar, is a single labelled image whose description lists every value, marks an unfinished month by hatching (not only colour), and offers the same numbers as a real table behind **Show as a table**. The branch list is a real table with a caption and row headers. (`src/components/ui/bar-chart.tsx` is reusable for the analytics page.)

### States

Loading (skeletons and `aria-busy` cards), empty period ("No loyalty activity in this period yet", empty branch and wallet states), partial data (a banner plus per-section errors that show the support reference and a retry), and full error for the headline figures (dashes, never invented numbers).

## Backend gaps noticed

- **No typed responses:** the OpenAPI spec has no response bodies for analytics and audit. The contract schemas in `lib/api/contract` follow `backend/docs/analytics.md` and the services; they should be replaced by generated types when the spec gains them.
- **Branch activity is the whole range:** there is no per-day series, so no trend of branch activity or of the headline figures can be drawn (only the monthly north-star has a series).
- **No comparison with the previous period** from the backend; the page shows none rather than computing it.
- **Audit entries have action codes only** (`stamp.issued`...): known codes are translated, unknown ones are shown as "Other activity (code)". A published list of action codes would let every one be translated.
- **No `merchant:read` for the logo or support details here**; the overview shows the name only.

## Testing

Unit: `range.test.ts` (calendar arithmetic, time-zone "today", presets, limits, address round-trip), `overview-dashboard.test.tsx` (figures, null/over-100% ratios, loading, empty, partial failure and retry, permissions, range changes, time zones, chart alternatives, events, wallet, Amharic, no money wording), `bar-chart.test.tsx`, `format.test.ts`. End to end (`tests/e2e/dashboard.spec.ts`, phone and desktop): the overview for owner and manager, range changes and reload, custom dates, empty period, loading, a failing section, chart and table, definitions, accessibility in both languages, tablet and phone navigation, no sideways scroll.
