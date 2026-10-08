# Authentication and protected areas

## Shape

The browser never holds a backend token. Sign-in goes through the app's own route handlers (a backend-for-frontend):

1. `POST /api/session/login` calls the backend, then stores the access and refresh tokens inside a sealed cookie (`tc_session`: AES-256-GCM, key derived from `TC_SESSION_SECRET`, `HttpOnly`, `SameSite=Lax`, `Secure` in production). Page scripts cannot read it; nothing is written to `localStorage` or `sessionStorage`.
2. Browser code calls `/api/bff/*`, which unseals the cookie, adds the bearer token and forwards to the backend. Only an allow-list of backend routes is forwarded (`src/lib/auth/bff-routes.ts`).
3. Server Components read the same cookie and call `/auth/me`; the backend is the source of truth for role and permissions on every request.

## Layers of protection

| Layer                         | Job                                                                                 | Authoritative?  |
| ----------------------------- | ----------------------------------------------------------------------------------- | --------------- |
| `src/proxy.ts`                | Cheap check: valid cookie, right kind of account for the area; redirects to sign-in | No (optimistic) |
| Group layouts (`requireArea`) | Calls `/auth/me`; right account kind and the area's entry permission                | Yes             |
| Pages (`requireRoute`)        | The exact permission for the route (`ROUTE_RULES` in `src/lib/auth/permissions.ts`) | Yes             |
| Backend                       | Enforces every action again                                                         | Yes             |

Hidden buttons are never the control: a forbidden page redirects to `/denied` on the server, and navigation is only a convenience derived from the same rules.

Areas: staff (`/staff/*`, needs `stamp:create`), merchant (`/dashboard/*`, needs `merchant:read`), operations (`/operations/*`, needs `platform:manage`). Merchant and staff accounts are merchant-kind; operations accounts are platform-kind.

## Sessions

- Refresh tokens are single-use and the backend treats reuse as theft. Refresh therefore runs only in route handlers (Server Components cannot set cookies), as a single flight with a 30 s grace cache, via the bounce `GET /api/session/refresh?next=…`.
  Limitation: the single-flight/grace state is per process; with several instances, concurrent refreshes from the same browser may hit different instances. Sticky sessions or a shared store would be needed to remove this.
- An absolute limit (`TC_SESSION_MAX_AGE_DAYS`, default 30) applies regardless of refreshing.
- Revoked, deactivated, signed-out-elsewhere and expired sessions end at `/api/session/end?reason=…`, which clears the cookie and explains why on `/session-expired`.
- Log out / log out of all devices: `/api/session/logout`, `/api/session/logout-all` (asks for confirmation first).

## CSRF and redirects

- Cookie is `SameSite=Lax`; state-changing requests also need `X-Requested-With: tc-web` and a same-origin `Origin`/`Sec-Fetch-Site`. (Strict would break arriving from links in messages; the extra checks cover the gap.)
- `next` parameters pass `safeNextPath`: same-site relative paths only, no schemes, `//`, backslashes, control characters, traversal or encoded tricks, no sign-in loops, and only destinations the account may open.
- The sign-in form posts natively to `/api/session/login`, so a submit before the page hydrates cannot leak the password into a URL.

## Branch context

Staff with several branches pick one at `/staff/branch`; the choice is an `HttpOnly` cookie (`tc_branch`) validated against `branches.list` on each use. Single-branch staff are placed automatically.

## Backend gaps noticed

- Staff cannot read the business name (`merchant:read` missing), so their shell shows the branch instead.
- No password-reset flow in the API.
- Login cannot tell "deactivated" from "wrong password"; deactivation is shown only once an existing session is refused.

## Testing

Unit: `src/lib/auth/*.test.ts`, `src/proxy.test.ts`, `src/app/api/*.test.ts`. End to end: `tests/e2e/auth.spec.ts` (every role against every route, desktop and phone), using the mock backend accounts in `src/mocks/README.md`.
