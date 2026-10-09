# Customers, rewards, redemptions and audit history

Pages: `/[locale]/dashboard/customers`, `/dashboard/rewards`, `/dashboard/audit`. Code: `src/features/records`, API clients in `src/features/{customers,memberships,audit}/api.ts`.

## Who can do what

|                                                                            | Owner | Manager | Branch staff                      | Read-only |
| -------------------------------------------------------------------------- | ----- | ------- | --------------------------------- | --------- |
| Customers and Rewards pages (`customer:read`)                              | yes   | yes     | yes                               | yes       |
| Full phone numbers, search by name or part of a number (`customer:manage`) | yes   | yes     | no (masked, complete number only) | no        |
| Visit history and reversals (`reversal:create`)                            | yes   | yes     | no                                | no        |
| Audit page and reward activity tabs (`audit:read`)                         | yes   | yes     | no                                | yes       |

The screens read the person's permissions to decide what to **offer**. That is a convenience, never protection: every page is re-checked on the server and every request by the backend. If a request the backend refuses is made anyway (a forced 403 in the tests), the refusal is shown in words and nothing changes.

## Customers

- Search (submit to search, no search-as-you-type), cursor paging 10 per page with Previous/Next.
- Columns: first name, phone, card status, offers consent, joined date, and a **View** button. A table from tablet width, labelled cards on a phone.
- **Masking.** The backend masks numbers (`+2519*****111`) for anyone without `customer:manage`, and branch staff must search with a complete number. The screen masks a number again if one ever arrives unmasked for someone without that permission (defence in depth, tested).
- **Details panel**: progress, rewards (Available / Given / Expired / Reversed), wallet cards with their state and update status, consent, and the visit history for owners and managers.
- **Consent** is shown as the current "offers and news" choice. The backend's consent _records_ sit behind `privacy:manage`, which these roles do not have, so no consent history is shown.

## Rewards and redemptions

The backend has **no merchant-wide list of redemptions or reversals**. The page therefore shows:

- **Find a customer's rewards**: the same customer search; the details panel lists the rewards they can claim.
- **Rewards given** and **Reversed events** tabs: read from the audit history (`reward.redeemed`, `redemption.reversed`, `stamp.reversed`), with branch and team-member filters and cursor paging. Needs `audit:read`.
- No money values exist in the data and none are shown.

## Manager reversals

1. **Reason** (required, 3 to 500 characters after trimming; the screen validates before anything is sent).
2. **Review**: the original entry is shown, and the person types `REVERSE` before "Reverse now" unlocks.
3. **Result**: the new correction, the progress and rewards after it, and a plain statement that the original is still in the history.

The history never implies anything was deleted: the original entry stays in the list with a "Reversed" badge (not struck through), the correction is added as its own entry ("Correction added — Reverses a stamp — Reason: …") and highlighted as new.

Safety rules, all covered by tests:

- One idempotency key per attempt. If the answer is lost and the person sends the same reason again, the **same key** is reused so the backend can answer "already recorded"; changing the reason starts a new attempt. The transport never retries a state-changing request by itself.
- Backend refusals are explained in words: already reversed, a given reward depends on this stamp (reverse the reward first), not allowed, invalid reason. The backend's English text is never shown.
- The reason is kept with the correction only. The mock audit entry for a reversal never contains it.

## Audit history

- Filters: date range (calendar days in Ethiopia's time zone; `to` includes that whole day), team member, branch, action, target type and a target reference. Applied with a button, any change returns to page 1. A start after the end is rejected on the screen.
- The team-member filter offers the people seen in the most recent 100 entries, because the staff list does not carry user ids (backend gap below).
- Human-readable action names; unknown codes appear as "Other activity (code)".
- **Expandable details** show only flat, safe metadata through `safeMetadata`: keys that look like secrets, tokens, passwords, hashes, cookies, sessions, keys, wallet credentials, IP addresses or devices are dropped; nested objects are not shown; long values are shortened. The backend already cleans metadata and gives owners network details; this client neither reads nor keeps them, and the filter is a second barrier. The mock deliberately includes bait values in a sign-in entry, and tests assert none of them reach the page.

## Backend gaps noticed

- No merchant-wide redemption or reversal list (see above); the audit feed stands in.
- The staff list has no `userId`, so the audit "team member" filter is built from people who appear in the history.
- The ledger is available only to `reversal:create`, so managers' read-only colleagues and branch staff cannot see visit history.
- Audit entries do not say which customer a reward or reversal concerned beyond a membership id in the metadata; the table shows "Customer card" without a name.
- Response bodies for these endpoints are not described in the OpenAPI document (marked `OPENAPI-GAP` in the contract layer).

## Testing

Unit: `records-rules.test.ts` (metadata filtering, masking, reason and date rules, error wording), `records-data.test.ts` (the mock backend's rules, so UI tests cannot pass for the wrong reason: paging, masking, search rules, idempotent reversals, already-reversed, reward-redeemed, append-only ledger, audit filters and time zone), and `records-workspaces.test.tsx`, which runs the **real feature clients over the mock backend as each account** (permissions, pagination, filters, masking, empty and error states, reversal steps and refusals, Amharic). End to end (`tests/e2e/records.spec.ts`, phone and desktop): searching and paging, a full reversal through the real screens, rewards tabs, audit filters and details, layout, accessibility and Amharic.
