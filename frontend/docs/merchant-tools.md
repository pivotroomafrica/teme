# Settings, fraud monitoring, privacy tools and campaigns

These screens replace the pages that used to say "not available yet". Three are built on operations the backend already has; **campaigns is a preview built on proposed operations that do not exist yet**.

## Settings (`/dashboard/settings`, needs `merchant:update`)

- Edits the business name (English and Amharic), the language customers see first, the time zone, the support email and phone, and the defaults offered when creating a program (stamps needed, minutes between stamps).
- Sends **only the fields that changed**; an emptied optional field is sent as `null` (clear it). Values are checked first (name 1 to 120 characters, e-mail, Ethiopian phone number, stamps 1 to 1000, cooldown 0 to 10080); the backend validates again and its refusals are shown in words.
- Changing the time zone shows a warning: it changes which day and month activity is counted in, including past reports.
- Read-only on the page: the join reference, the short name and the status (only TemelashCard changes a status).
- **Logo.** The backend can record logo _metadata_ but has no file storage, so a logo cannot be uploaded. The page says so; brand colour and the first letter of the name are used instead.

## Fraud monitoring (`/dashboard/fraud`, needs `fraud:read`; owners also `fraud:manage`)

- **Flags**: raised by the backend when activity passes a limit. Filter by status and by what was noticed, 10 per page (cursor). Each shows what it means in words, who or what it is about, when, and what was measured against the limit.
- **Indicators only point things out.** Nothing is blocked, suspended or reported automatically, and customers are never penalised; the screen says so.
- **Review** (owners): "False alarm" or "Looks genuine", with an optional note of at most 500 characters kept with the flag only (the screen asks for no personal details). A flag can be reviewed once; a second attempt is explained.
- **Limits**: every indicator can be switched off and its numbers changed within the backend's ranges, shown beside each field. Only changed settings are sent. Managers see the limits but cannot change them.
- **Run the checks now** (owners) instead of waiting for the scheduled run.

## Privacy and customer care

- **Customer panel** (customers page, rewards lookup): for people with `customer:manage`, stop marketing messages, pause or resume the card, replace the card (the new code is shown once and not kept), remove wallet cards after a lost phone, and send one wallet card's update again. For owners (`privacy:manage`): view the stored data, download a copy as a JSON file, and anonymise.
- **Anonymise** is irreversible and says what it does: the name and phone number are removed, every card closes, wallet cards are removed; visit history stays but no longer points to a person. It needs a typed word, and if the customer still has an unclaimed reward the backend refuses (`REWARDS_OUTSTANDING`) until a tick box acknowledges that it will be lost.
- **Privacy page** (`/dashboard/privacy`, owners): the automatic clean-up period (0 = off, otherwise 6 to 120 months), and "apply now", which anonymises up to 200 inactive customers without an unclaimed reward, after a typed confirmation, and reports how many.
- Viewing and exporting are recorded in the audit log by the backend, without the customer's details. The downloaded copy is held in memory only for the download.

## Campaigns (`/dashboard/campaigns`, needs `customer:manage`) — PREVIEW

The backend has **no campaign operations**. By your decision the screen is built against a proposed API that exists only in the mock backend:

| Proposed operation                     | Meaning                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /merchant/campaigns`              | Campaigns, newest first, cursor-paged                                                  |
| `POST /merchant/campaigns`             | Make a draft: `name` (1-80), `messageEn` (1-300), optional `messageAm`, `audience`     |
| `POST /merchant/campaigns/{id}/send`   | Send a draft. Needs `Idempotency-Key`; repeating it changes nothing (`replayed: true`) |
| `POST /merchant/campaigns/{id}/cancel` | Cancel a draft                                                                         |

Audiences: everyone who agreed to marketing, not seen for 30 days, close to a reward. **Only customers who agreed to marketing, and who are not anonymised, are ever included.** The audience size is worked out by the service when the draft is made and shown before sending; sending asks for a confirmation that names the number.

Safety: the screen starts with a "Preview only" notice ("Nothing is sent to any customer"). The mock records that a campaign was sent and delivers nothing. In a production build there is no mock, so the service answers 404 and the page shows "Campaigns are not available yet" instead of an error. The four routes are listed, with the reason, in the `MOCK_ONLY` allow-list of `openapi-reconcile.test.ts`; when the backend adds real campaigns, replace the proposal with its contract and delete that list.

## Bug fixed on the way

A dialog nested inside another (a confirmation inside the customer panel) also closed or blocked the one around it, because React bubbles `close` and `cancel` events through its component tree. Each dialog now reacts only to its own events (`src/components/ui/dialog.tsx`, with a regression test).

## Testing

Unit: `settings-form.test.tsx`, `fraud-workspace.test.tsx`, `privacy-tools.test.tsx`, `campaigns-workspace.test.tsx` (each runs the real clients over the mock backend as the owner, a manager and a read-only account: permissions, validation, confirmations before anything is sent, idempotent retries, refusals in words, empty and error states, Amharic) plus the mock backends' own rules. End to end: `tests/e2e/merchant-tools.spec.ts` (phone as manager, desktop as owner) and the accessibility sweep in `hardening.spec.ts`, which now includes the new pages in both languages.
