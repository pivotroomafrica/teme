# Customer enrollment (`/[locale]/join/[joinReference]`)

A customer scans a QR code or opens a link a business gave them, and gets a loyalty card in one short form. No password, no account.

## Journey

1. **Load** (server): `GET /join/{joinReference}` with no session. The page is rendered on the server, so the business name, reward and stamps needed appear with the first response; only the form is JavaScript.
2. **Summary:** logo (a coloured monogram: the API has no logo field yet), business, program, reward, "collect N stamps". Business-written text is shown exactly as written. On the Amharic page the business's Amharic text is used when it wrote one; otherwise the English original is shown and marked `lang="en"`. Nothing is machine-translated.
3. **Language:** the customer chooses with the language switcher in the header. The page language is also the language recorded as `preferredLanguage` (`EN`/`AM`) and is stated above the consents.
4. **Form:** first name, Ethiopian phone number (`+251` shown; `0911…`, `911…`, `+251 911…` all accepted), then two **separate** consents: the program terms (required; the terms open in a disclosure) and marketing messages (optional, unticked).
5. **Submit:** `POST /join/{joinReference}/enroll` through `/api/bff`. The phone is sent as `+251…`; the consent text version from step 1 is sent back (`consentVersion`).
6. **Result:**
   - `CREATED`: confirmation, then **wallet choice** (web card always; Apple/Google are shown, and disabled with an explanation when the backend reports them unavailable).
   - `EXISTING`: a friendly "you are already a member" message. No card is returned and no details about the member are shown.

## States

| State                            | When                                                   | What the customer sees                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unavailable                      | The backend answers 404, or the reference is malformed | "This join link is not available" with the likely reasons, and a link home                                                                             |
| Temporary problem                | Busy (429), down (503), timeout, network               | The reason in plain words, and a **Try again** link (a plain link, so it works before any script loads). Nothing was submitted                         |
| Validation                       | Empty or invalid fields                                | A message at each field, nothing is sent                                                                                                               |
| Stale terms                      | `409 CONSENT_VERSION_STALE`                            | "The terms have changed", the terms checkbox is unticked, the page data is refreshed                                                                   |
| Network failure while submitting | The request never completed                            | The details stay in the form; the message explains that the card may or may not have been created, and what to do if the retry says "already a member" |
| Rate limited                     | 429                                                    | "Please try again in N seconds"                                                                                                                        |

## Safety decisions

- **Unknown, suspended, paused, archived and expired are one state.** The backend deliberately returns the same 404 for all of them, so the page cannot (and does not) tell them apart. That is why there is no separate "paused" or "expired" screen: it would need a backend change that would also let anyone probe which businesses exist.
- **No cross-business information.** The only existing-member answer is for the _same_ business; the response is the same shape and wording whatever happened elsewhere. The page never shows names, phone digits or any stored data of an existing customer.
- **No internal identifiers** are rendered. The join reference in the address is the public link; business and program ids are not in the response and not in the page.
- **One submission at a time.** The submit button is disabled and shows progress while sending, a ref guard ignores a second tap or Enter that lands before the re-render, and the button stays disabled until the page is interactive (so nothing can be submitted natively). A state-changing request is never retried automatically.
- **Card hand-off:** the card token is returned once. The page hands it to the server straight away (`POST /api/card/session`), which keeps it in a sealed HttpOnly cookie; the browser then refers to the card by an opaque id. If saving fails the customer can retry, and `/card#t=…` is the fallback. See [customer-card.md](customer-card.md).
- **Only the text this page needs** (`enrollment`, `wallet` dictionaries) is sent to the browser.
- Join pages are `noindex`.

## Backend gaps noticed

- No `GET` that distinguishes an inactive program from an unknown link (by design, see above).
- A customer who is told "already a member" has no way to get their card back from this page. Staff can re-issue it (`/merchant/memberships/{id}/reissue-card`); a customer-side recovery (for example a one-time code by message) does not exist.
- No logo URL on the merchant in the join response.
- `POST /join/{ref}/enroll` takes no idempotency key, so a retry after a lost response is answered as `EXISTING` and the token is not shown again. An idempotent enroll would remove that edge.

## Testing

- Unit: `src/lib/validation/enrollment.test.ts`, `src/features/enrollment/**/*.test.ts(x)` (validation, consents, new/existing, duplicates, network failure, rate limit, stale terms, server field errors).
- End to end (mock backend, phone and desktop): `tests/e2e/enrollment.spec.ts`. In the mock, `sample-cafe` works, `busy` is rate limited, `down` is unavailable, anything else is unavailable; phone numbers ending `0000` are existing members.
- The production-build e2e run uses an unreachable backend and checks that the page degrades to the retry state.
