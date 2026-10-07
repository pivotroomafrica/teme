# Authentication, authorization and tenant isolation

Interactive documentation: `/api/docs` (Swagger, when `SWAGGER_ENABLED=true`). Everything below is under `/api/v1`.

## Accounts

| Account                             | `accountType`    | Role             | Reaches                                               |
| ----------------------------------- | ---------------- | ---------------- | ----------------------------------------------------- |
| TemelashCard platform administrator | `PLATFORM_ADMIN` | `PLATFORM_ADMIN` | `/platform/*` only                                    |
| Merchant owner                      | `MERCHANT_USER`  | `OWNER`          | their merchant, all branches                          |
| Merchant manager                    | `MERCHANT_USER`  | `MANAGER`        | their merchant, all branches, no owner/privacy powers |
| Branch staff                        | `MERCHANT_USER`  | `STAFF`          | scanner permissions at **assigned branches only**     |

Platform and merchant principals are disjoint: a platform admin has no staff membership and no merchant id; a merchant
user can never satisfy a `platform:*` permission. A platform administrator has **no implicit access to tenant data**.

## Flows

**Login** `POST /auth/login {email, password, deviceLabel?}` → `{accessToken, refreshToken, tokenType, expiresIn, user}`

- Passwords are verified with argon2id. Unknown account, wrong password, deactivated account, missing active membership
  and temporary lockout all return the same `401 INVALID_CREDENTIALS`; unknown accounts cost the same time as known ones.
- Rate limited per **IP + email** (`LOGIN_RATE_LIMIT_MAX` per `LOGIN_RATE_LIMIT_TTL_SECONDS`, default 5/60 s) → `429 RATE_LIMITED`.
- 10 consecutive failures lock the account for 15 minutes (in addition to the rate limit, to stop distributed guessing).

**Access token**: HS256 JWT, 15 minutes (`ACCESS_TOKEN_TTL_SECONDS`), issuer-checked, algorithm pinned. Claims identify
_who_ only (`sub`, `typ`, and for merchants `sid`/`mid`). On **every request** the server reloads the user, membership,
role, permissions and branch assignments from PostgreSQL and checks that the `mid` claim equals the membership's
merchant. Consequences: deactivation, role changes and branch changes take effect immediately, and a token cannot be
edited to point at another tenant.

**Refresh** `POST /auth/refresh {refreshToken}`: refresh tokens are 256-bit random values, stored only as SHA-256 hashes,
single use, and rotated on every call. Presenting an already-used token (theft or a lost race) revokes the entire
device session (token family) and writes an `auth.refresh_reuse_detected` audit event.

**Logout** `POST /auth/logout {refreshToken}` ends one device session and always returns 204 (no token oracle).
`POST /auth/logout-all` (authenticated) ends every session of the caller.

**Who am I** `GET /auth/me` → role, permissions, merchant id, branch scope (`"ALL"` or a list of branch ids).

## Authorization

Every route must declare its access; the guards run in the order **rate limit → authenticate → authorize**:

- `@Public()` – no authentication (login, refresh, logout, health).
- `@Permissions('x:y', ...)` – all listed permissions required. `platform:*` permissions need a platform actor, all others a
  merchant actor.
- `@AuthenticatedOnly()` – any signed-in principal.
- **Anything undeclared is denied** (fail closed) and logged.

Permission catalog and role mapping: `prisma/reference-data.ts` (seeded idempotently; the catalog is authoritative).

## Tenant isolation

1. `merchantId` is derived only from the authenticated membership. No merchant route accepts a merchant id; unknown body
   fields are rejected (400) and query strings are ignored.
2. Repositories take `merchantId` as a required argument; the database enforces the same with composite foreign keys.
3. Another tenant's resource, and an unassigned branch, both answer `404`, identical to a missing resource.
4. Branch staff get `branchScope` = their assigned **active** branches; owners and managers get `ALL`.

## Staff management rules (full details: [organization-management.md](organization-management.md))

- Nobody can change their own role or status.
- Owners manage everyone; managers manage branch staff only and cannot grant a role above `STAFF`.
- The last active owner cannot be demoted or deactivated; owner rows are locked (`SELECT … FOR UPDATE`) so concurrent
  requests cannot both succeed.
- Deactivation keeps the record and history, and revokes the person's refresh tokens.

## Audit events written

`auth.login`, `auth.login_failed` (reason, IP, user agent, a short fingerprint of the attempted address — never the
address itself), `auth.logout`, `auth.logout_all`, `auth.refresh_reuse_detected`, `staff.role_changed`
(`from`/`to`), `staff.deactivated`, `user.deactivated`. Metadata passes through a sanitizer that redacts keys such as
`password`, `token`, `hash`, `secret`, `authorization`, `email`, `phone`.

## Operational notes

- Rate-limit counters are in process memory. Run a shared store (Redis) before scaling beyond one instance.
- When deployed behind a proxy, configure Express `trust proxy` so `req.ip` is the client address (done in the hardening step).
- Rotate `JWT_ACCESS_SECRET` by deploying a new value; all access tokens expire within `ACCESS_TOKEN_TTL_SECONDS`.
- A user with several merchant memberships currently receives the earliest active one at login.
