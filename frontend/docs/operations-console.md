# Operations console (`/[locale]/operations`)

An internal console for TemelashCard platform administrators. It does what the backend supports today and says plainly what it does not, rather than showing empty or invented screens.

## Access

- Only an account of kind **platform** holding the explicit permission can open any operations route: `platform:manage` for everything, and **additionally** `platform:audit:read` for the audit page (`platform:manage` alone is not enough).
- Merchant owners, managers, branch staff and read-only accounts are turned away from every operations address, including nested and unknown ones (`/operations/anything`), and never see an operations link: operations navigation is built only for the operations area. Platform administrators in turn cannot open merchant or staff pages.
- Every operations page runs the shared frame `OpsFrame`, which calls `requireRoute` **before** anything is fetched or rendered. A test reads every `page.tsx` under `(operations)` and fails if one does not use the frame with its own route, so a new page cannot ship unprotected.
- All of this is a convenience for the interface. The backend refuses every platform call from a merchant account (403) and re-checks every request; tests force that refusal and check the screen reports it in words.

## Pages

| Route                                | What it shows                                                                                                                            | Backend it uses                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/operations`                        | Merchant counts by status, background-job counts, whether the service is ready, and the list of things the service does not offer        | `GET /platform/merchants`, `GET /platform/outbox/stats`, `GET /health`, `/health/ready`                 |
| `/operations/merchants`              | Search, status filter and paging over all merchants (name in either language, short name, status)                                        | `GET /platform/merchants`                                                                               |
| `/operations/merchants/[merchantId]` | Organisation-level data and, after a confirmation, the merchant's recent activity                                                        | `GET /platform/merchants`, `GET /platform/audit?merchantId=…`                                           |
| `/operations/wallet-health`          | Job counts and the wallet and background jobs that used all their attempts, with a safe summary of the error and a confirmed retry       | `GET /platform/outbox/stats`, `GET /platform/outbox/dead`, `POST /platform/outbox/dead/{jobId}/requeue` |
| `/operations/privacy`                | Per-merchant record of customers anonymised, marketing consent withdrawn and customer data viewed or exported, read from the audit trail | `GET /platform/audit?merchantId=…`                                                                      |
| `/operations/audit`                  | Platform-level events (what administrators did); a merchant can be chosen to see its activity                                            | `GET /platform/audit`                                                                                   |
| `/operations/system`                 | Is the service running, and can it reach its database                                                                                    | `GET /health`, `GET /health/ready` (read on the server)                                                 |
| `/operations/fraud`                  | States that the service has no platform-wide view of suspicious activity or reversal rates                                               | none                                                                                                    |

## Safety rules

- **Audited mutations only.** The one change the console can make is giving a dead outbox job a fresh set of attempts. It needs a confirmation, is sent once, and the backend records it as `outbox.job_requeued`. A job that is gone or no longer dead is explained ("someone else may have retried it").
- **Naming a merchant is recorded.** The backend writes `audit.platform_accessed` in that merchant's own history whenever a platform administrator asks for its activity. So nothing is requested until the person confirms that, and the result is never refetched on focus or reconnect.
- **No secrets.** Job error text is already scrubbed by the backend; `redactError` hides secret-looking values, bearer tokens, JWT-shaped and long opaque strings again and shortens the text. Audit details go through the same flat, filtered `safeMetadata` used by the merchant audit, which drops IP addresses, devices, tokens and passwords (the platform audit always includes network details; this client does not show them). The system page shows only yes or no, never settings, keys or credentials. Mock data carries bait values, and tests assert none reach the page.
- **No personal data.** The platform routes carry organisation-level data only. The privacy view lists audit records, which hold internal ids but no names, phone numbers or other personal details.
- **No money.** There are no billing, subscription, revenue or payment screens, and a test checks the pages for such words.

## What the service does not offer yet (backend gaps)

The brief lists capabilities that need backend endpoints which do not exist. The console does not pretend to have them and states this on the relevant pages; they need backend work before the screens can follow.

- **Merchant onboarding, approval and status changes.** Only listing exists. Onboarding is done with the `bootstrap` command-line tool. Needs: create, approve, suspend and reactivate endpoints, audited.
- **Program status, branch and staff summary per merchant, support-case context.** There are no per-merchant platform endpoints (the list returns id, short name, names and status only). Needs: a platform merchant-detail endpoint with counts.
- **Platform-wide suspicious activity and high reversal rates.** Fraud flags and thresholds are per merchant and reviewed by that merchant's owner. Needs: a platform flag listing.
- **Privacy export and deletion queue.** Export and anonymisation are carried out by merchant owners. Needs: platform-visible request records.
- **Wallet-provider failures** are only visible as dead and retrying outbox jobs, not per provider. Needs: provider and error-class fields.
- **Looking up a login account.** `POST /platform/users/{userId}/deactivate` exists, but there is no way to list or search accounts to find a `userId`, so the console does not offer it.
- Response bodies for the platform routes are not described in the OpenAPI document (`OPENAPI-GAP` in the contract layer). Shapes follow the backend controllers.

## Testing

Unit: `ops-rules.test.ts` (error redaction, merchant filtering), `ops-data.test.ts` (the mock backend's rules and **every merchant-side account refused on every platform route**), `operations-access.test.ts` (route and navigation matrix for every account kind, the audit-needs-its-own-permission rule, the browser proxy, and the guard that every operations page uses the access frame), and `ops-workspaces.test.tsx` (the real clients over the mock backend: lists, paging, filters, confirmations before any recorded read or any retry, refusals, hidden credentials, empty and error states, Amharic). End to end (`tests/e2e/operations.spec.ts`, phone and desktop): the administrator's navigation, merchants and the recorded confirmation, wallet health and a confirmed retry, system, audit, every merchant-side account turned away from every operations page with no operations link, the proxy refusing unauthenticated platform calls, layout, accessibility and Amharic.
