# Organisation management: merchant, branches, staff

All routes are under `/api/v1`, require a merchant access token, and take the merchant **only** from that token.
No route accepts a merchant id; bodies with unknown fields (`merchantId`, `status`, `slug`, …) are rejected with 400.
Another tenant's resource always answers `404`, identical to a missing one. Interactive docs: `/api/docs`.

## Permissions

| Operation                                                         | Permission                          | Owner        | Manager           | Branch staff                  |
| ----------------------------------------------------------------- | ----------------------------------- | ------------ | ----------------- | ----------------------------- |
| View / update profile, logo                                       | `merchant:read` / `merchant:update` | yes          | yes               | no                            |
| List / view branches                                              | `branch:read`                       | all branches | all branches      | assigned active branches only |
| Create / update / (de)activate branch                             | `branch:manage`                     | yes          | yes               | no                            |
| List / view staff, view activity                                  | `staff:read`                        | yes          | yes               | no                            |
| Invite, reissue, assign branches, change role, (de)activate staff | `staff:manage`                      | any member   | branch staff only | no                            |

## Merchant profile (`/merchant/profile`)

- `GET` / `PATCH`: English name (`nameEn`) and Amharic name (`nameAm`, nullable), IANA `timezone`, `defaultLanguage`,
  `supportEmail`, `supportPhone` (normalised to E.164), and program defaults `defaultStampsRequired` (1–1000) and
  `defaultCooldownMinutes` (0–10080). `PATCH` is partial; `null` clears optional fields; an unchanged update is a no-op.
- `PUT /merchant/profile/logo {contentType}` records **logo metadata only**: the server reserves a storage key under
  `merchants/<merchantId>/logo/<uuid>.<ext>` (png, jpeg, webp). No file storage exists yet; a later step will hand out an
  upload URL for that key. `DELETE` clears it. Clients cannot choose the key.
- The merchant's timezone drives date ranges in analytics (Prompt 10).
- Audit: `merchant.profile_updated` stores **field names only** (contact details are personal data), `merchant.logo_updated`, `merchant.logo_removed`.

## Branches (`/merchant/branches`)

- Fields: `nameEn`, `nameAm`, `addressText`, `city`, `phone` (normalised to E.164), `status`.
- Deactivation keeps the row and all history. Assigned staff stop being able to see or operate at the branch immediately
  (assignments are kept; re-activation restores access). **A merchant always keeps at least one active branch**
  (`409 LAST_ACTIVE_BRANCH`), enforced under a row lock so concurrent requests cannot empty it.
- Audit: `branch.created`, `branch.updated` (field names), `branch.deactivated`, `branch.activated`.

## Staff (`/merchant/staff`)

**Invite** `POST /merchant/staff {email, displayName, role, branchIds[], preferredLanguage?}`
creates a login account with no usable password and a membership in `INVITED` status, and returns a one-time
`invitation.token` (valid 7 days, stored only as a hash). **Email delivery is not implemented**: the inviter hands the
token to the invitee (link, chat, in person). The invitee calls the public `POST /auth/invitations/accept {token, password, displayName?}`,
then logs in normally. Notes:

- Branch staff need at least one active branch; owners and managers may have none (they see all branches).
- Branches must be active branches of the caller's merchant; foreign and unknown ids give the same 400.
- If the address is already registered anywhere (this merchant, another merchant, a platform admin) the answer is
  the same `409 INVITE_NOT_POSSIBLE`, so the endpoint does not reveal where an address is used. Concurrent invitations for
  one address: exactly one wins.
- Acceptance is single use and race-safe; unknown, expired, revoked and used tokens all return the same
  `400 INVALID_INVITATION`. Passwords: 12–128 chars, a letter and a digit, not containing the email name.
- `POST /merchant/staff/:id/invitation` reissues (old link dies). Deactivating a pending invitee revokes the link.

**Roles and safety rules**

- Nobody can change their own role, branches or status (no self-promotion).
- Owners manage everyone; managers manage branch staff only and cannot grant a role above `STAFF`.
- **The last active owner cannot be demoted or deactivated**, enforced with `SELECT … FOR UPDATE` on the owner rows, so two
  owners removing each other at the same instant cannot both succeed (`409 LAST_OWNER`).
- Deactivation preserves the membership, its branch assignments and every ledger/audit row that references it, revokes the
  person's refresh tokens, and takes effect on their next request. `POST …/activate` restores a deactivated member
  (not a pending invitee, and not if the underlying account is deactivated).
- `PUT /merchant/staff/:id/branches {branchIds[]}` replaces the assignment set (audited with added/removed ids).

**Activity** `GET /merchant/staff/:id/activity?limit&cursor`: counts of stamps issued, redemptions processed and
reversals performed (from the append-only ledgers; zero until the scanner exists), `lastActiveAt`, and a newest-first
keyset-paginated feed of that person's audited actions in this merchant. Event metadata (IP addresses, user agents) is
deliberately not exposed.

## Audit actions added in this step

`merchant.profile_updated`, `merchant.logo_updated`, `merchant.logo_removed`, `branch.created`, `branch.updated`,
`branch.deactivated`, `branch.activated`, `staff.invited`, `staff.invitation_reissued`, `staff.invitation_accepted`,
`staff.branches_changed`, `staff.activated` (plus `staff.role_changed` and `staff.deactivated` from the previous step).
Emails, phone numbers, tokens and passwords never enter audit metadata.

## Limitations

- No email/SMS delivery of invitations (inviter shares the token); a notification port will be added with the wallet/background-job work.
- A user belongs to one merchant in practice: addresses are globally unique, and invitations to an existing account are refused.
- Logo files are not stored; only metadata and a reserved key.
