# Branches and team (`/[locale]/dashboard/branches`, `/[locale]/dashboard/team`)

## Who can do what

|                                                                              | Owner  | Manager           | Branch staff                   |
| ---------------------------------------------------------------------------- | ------ | ----------------- | ------------------------------ |
| Open the pages                                                               | yes    | yes               | no (turned away by the server) |
| Branches: list, add, edit, activate, deactivate (`branch:manage`)            | yes    | yes               | no                             |
| Team: list, activity (`staff:read`)                                          | yes    | yes               | no                             |
| Team: invite, change role or branches, activate, deactivate (`staff:manage`) | anyone | branch staff only | no                             |

The screens read the person's permissions and role to decide which buttons to **offer**. That is a convenience, never protection: a disabled or missing button is not authorization, the server re-checks each page, and the backend re-checks every request. If a request the backend refuses is made anyway, its refusal is shown in words (`explainOrgError`). Tests cover this directly by forcing a 403 from the backend and checking that the screen reports it and changes nothing.

## Branches

- A table from tablet width, labelled cards on a phone (one layout on screen at a time, so nothing is read out twice). Search by name or city, 10 per page.
- Add and edit in a dialog: English name (required), Amharic name, address, city, phone. The limits mirror the backend (120 / 120 / 300 / 80 / 32 characters; any common Ethiopian phone format, normalised to +251… by the backend). Edit sends **only the changed fields**; clearing a field sends `null`.
- Deactivate asks first and says what happens (team members assigned there can no longer scan or give rewards; history is kept; it can be activated again). **A business must keep at least one active branch**: the backend refuses the last (`409 LAST_ACTIVE_BRANCH`) and the screen explains it.
- "Team here" lists the active and invited people assigned to a branch (needs `staff:read`) and notes that owners and managers can work at every branch.

## Team

- Table or cards, search by name or email, filter by role and status, 10 per page. Each person shows role, status (invitation pending / active / deactivated) and branches ("Every branch" for owners and managers who have none assigned). Nothing about passwords, hashes, devices or IP addresses exists in the data the backend sends, and none is shown.
- **Invite**: email, name, role (owners can choose any role, managers only branch staff), branches (at least one for branch staff; optional for owners and managers), language. The backend creates an _invited_ account and returns a **one-time code**. **No email is sent** (the backend has no delivery yet), so the screen shows the code once, in a box that can be copied, with its expiry, and asks the person inviting to hand it over. The code is not kept: closing the dialog removes it, and a test checks it is gone from the page.
  - An email already used here or anywhere else gives the same careful answer (`INVITE_NOT_POSSIBLE`), so the form never reveals where an address is used.
- **Change role**: a dialog showing the current role, with extra care for owners: removing owner access needs a typed word (`CONFIRM`), and if the person is the only active owner the screen says the backend will refuse. The backend's `LAST_OWNER` refusal is shown if it is attempted anyway.
- **Change branches**: replaces the whole set. Branch staff cannot be left with none; branches already assigned stay listed (marked "not active") even if deactivated, and only active branches can be added.
- **Deactivate / activate**: confirmation first (owners need the typed word); deactivating signs the person out everywhere and keeps their history. Someone who has not accepted yet is offered **"New invitation code"** (the old code stops working) instead of "Activate". A deactivated person cannot be edited until activated.
- **Recent activity**: counts of stamps issued, rewards given and reversals, last active time, and a newest-first list of audited actions that loads 10 more on request (cursor paging from the backend).

### Protecting necessary access

- You are marked "You" and every management action for yourself is disabled, with a note. The backend refuses it too (nobody changes their own role, branches or status).
- Managers see a note and have management disabled for owners and other managers.
- Changes that remove owner access ask for a typed word, and the last active owner is protected by the backend and explained by the screen.

## Backend gaps noticed

- **No paging for branches or staff**: the backend returns each list whole. The screens page them in memory (10 per page), which is fine for the sizes the product expects but would need server paging for very large teams.
- **No email for invitations**, and **no page for the invitee to accept one**: the backend has `POST /auth/invitations/accept`, but this frontend has no acceptance screen yet, so a person who receives a code cannot finish onboarding. This should be built before staff are invited for real.
- Refusals for "your own role", "someone else's role" and "a deactivated member" all arrive as the same `403` / `409` code, so the screen explains them from context rather than from the code. Distinct codes would remove the guesswork.
- The activity feed shows action codes only; known ones are translated, unknown ones appear as "Other activity (code)".

## Testing

Unit: `team-rules.test.ts`, `branch-form.test.ts`, `use-paged.test.tsx`, `org-data.test.ts` (the mock backend's rules, so UI tests cannot pass for the wrong reason), and the two workspace suites, which run the **real feature clients over the mock backend as each account**: owner, manager, branch staff and a read-only account (lists and paging, filters, invite and one-time code, role, branches, activate and deactivate, last owner, last active branch, forced 403s, loading and error states, Amharic). End to end (`tests/e2e/team.spec.ts`, phone and desktop): the full life of an invitation through the real screens, branches, restrictions for manager, staff and read-only accounts, layout, Amharic and accessibility.
