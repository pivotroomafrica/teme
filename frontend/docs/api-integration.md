# API integration

How the frontend talks to the TemelashCard backend. The backend contract is its OpenAPI document; nothing here invents endpoints.

## Layers

```
Server / Client Component
        │  calls
feature service      src/features/<feature>/api.ts     typed operations ("enroll", "stamp", "login")
        │  uses
Transport            src/lib/api/http.ts               createHttpTransport: the ONLY code that does HTTP
   ├─ live           HTTP to the backend (server)  or  to /api/bff (browser)
   └─ mock           src/mocks/mock-transport.ts       in-process fake backend (same interface)
```

- **Pages and components never call `fetch`.** ESLint forbids `fetch` inside `src/components`; features and route code use services.
- **Server code** gets an API with `getServerApi({ accessToken })` (`lib/api/server.ts`, `server-only`). The token comes from the sealed session cookie and never leaves the server.
- **Browser code** gets `getBrowserApi()` (`lib/api/browser.ts`). It calls this app's own `/api/bff/*` route handlers (built in the authentication step), which add the bearer token server-side. The browser never sees a token.
- **Mock vs live** is `TC_API_MODE=live|mock` (server variable). Services are identical in both modes; only the transport differs. Production rejects `mock`.

## Types: generated + a small contract layer

| Source                              | What it provides                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/lib/api/generated/schema.d.ts` | **Generated** from `openapi/openapi.json` (never edited by hand). Request bodies and DTOs. |
| `src/lib/api/types.ts`              | Helpers: `Schemas["LoginDto"]`, `RequestBody<path, method>`, `ResponseBody<path, method>`. |
| `src/lib/api/contract/index.ts`     | Zod schemas for responses the spec leaves vague; validates every answer at run time.       |

### Regenerating when the backend changes

```bash
# 1. backend running with SWAGGER_ENABLED=true
BACKEND_OPENAPI_URL=http://localhost:3000/api/docs-json npm run api:sync   # updates openapi/openapi.json
npm run api:generate                                                        # updates the generated types
npm run typecheck && npm test                                               # drift shows up as type errors / failing contract tests
```

`npm run api:check` (part of `npm run check`) fails if the generated file is not exactly what the committed spec produces. Generated files live in their own folder (`src/lib/api/generated`), are ignored by ESLint and Prettier, and are kept apart from hand-written adapters. Fields with defaults are generated as optional (`--default-non-nullable false`) because clients may omit them.

### OpenAPI gaps (reconcile when the backend improves)

The backend document is accurate for requests but incomplete for responses. Each gap is handled in `contract/index.ts` and tagged `OPENAPI-GAP`:

1. **Bare `object` responses.** 92 properties (join info, enrollment result, scan result progress/stamp/reward, redeem result, ...) are `object` with no fields. Filled in by Zod schemas written from the backend source.
2. **Missing response body.** `POST /card/web` documents no success body. Schema: `webCardSchema`.
3. **Nullable fields typed wrongly.** 69 fields such as `BranchDto.nameAm` or `SessionUserDto.merchantId` are typed `Record<string, never> | null` instead of `string | null` (the Swagger plugin loses the type of `string | null`). Refined where used (`Branch`, `Session`, ...); `contract.types.test.ts` compares everything else against the generated types.
4. **Unreferenced inline types** for analytics, audit, fraud and privacy responses will need the same treatment when those screens are built.

Backend fix that removes most of this: declare explicit `type`/`nullable` in the `@ApiProperty` decorators and add `@ApiOkResponse({ type })` to the undocumented routes. Then delete the matching schemas.

## Transport guarantees

For every request (`createHttpTransport`):

| Concern                  | Behaviour                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correlation              | One `X-Request-Id` per request (kept across retries); returned in errors and logs as the support reference.                                                                     |
| Credentials              | Bearer token from a provider function, never from a URL, storage or logs. `credentials` is explicit (`omit` to the backend, `same-origin` to the BFF).                          |
| Query / path             | `serializeQuery` percent-encodes, sorts keys, skips empty values; `fillPath` encodes path parameters and refuses missing ones.                                                  |
| Timeout and cancellation | Default 10 s (configurable, per request override); callers pass an `AbortSignal`. Timeout and cancel are different error kinds.                                                 |
| Retries                  | **Safe reads only** (GET/HEAD): up to 2 retries with exponential backoff, only for network errors, timeouts and 502/503/504. Never for 4xx, malformed answers or cancellations. |
| State-changing requests  | POST/PUT/PATCH/DELETE are sent **exactly once**, always. This is not configurable. Stamping, redemption and reversal included.                                                  |
| Idempotency              | `Idempotency-Key` header support with the backend's own format check (8-128 chars of `A-Za-z0-9._:-`).                                                                          |
| Responses                | JSON parsed once; optional Zod `parse` validates the shape; anything wrong is a `malformed` error, never a crash.                                                               |
| Logging                  | Method, path (no query), status, duration, request id, error kind. No headers, bodies, tokens, phone numbers or query strings.                                                  |

### Idempotency keys for scanner actions

One key per **user action** (one tap on "Add stamp"). If the answer is lost (network error, timeout), the staff member taps again and the **same key** is sent, so the backend returns the original result (`replayed: true`) instead of stamping twice. A different action gets a new key (`newIdempotencyKey()`). Reusing a key for a different card answers 422 `IDEMPOTENCY_KEY_REUSED`. The transport never retries these requests by itself; the retry is always a deliberate tap.

## Errors

Everything thrown is an `ApiError` (`lib/errors/api-error.ts`):

| `kind`                            | Typical cause / UI reaction                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `validation`                      | 400. Show `fieldErrors` next to inputs (`firstName: "should not be empty"`).                |
| `unauthenticated`                 | 401. The session layer refreshes or signs out (`onUnauthorized` / `tc:unauthorized` event). |
| `forbidden`                       | 403. Permission-denied state; no sign-out.                                                  |
| `not_found`                       | 404 (also "not yours").                                                                     |
| `conflict`                        | 409 with a business `code` (`CONSENT_VERSION_STALE`, `PROVIDER_NOT_AVAILABLE`, ...).        |
| `unprocessable`                   | 422 (`IDEMPOTENCY_KEY_REUSED`).                                                             |
| `rate_limited`                    | 429 with `retryAfterSeconds`.                                                               |
| `unavailable` / `server`          | 502-504 / other 5xx. Offer retry.                                                           |
| `network` / `timeout` / `aborted` | The request did not complete / our deadline / the caller cancelled.                         |
| `malformed`                       | The success answer broke the contract.                                                      |

`describeApiError(error, t)` (`lib/errors/messages.ts`) returns English or Amharic text. The backend's own `message` is English-only and technical, so it is never shown to people.

### Mapping validation errors onto a form (React Hook Form)

```ts
try {
  await api.enrollment.enroll(ref, values);
} catch (e) {
  const error = toApiError(e);
  for (const [field, message] of Object.entries(error.fieldErrors))
    form.setError(field as never, { message });
  if (error.kind !== "validation") toast.show({ tone: "danger", ...describeApiError(error, t) });
}
```

## Mock mode

`TC_API_MODE=mock npm run dev`. The fake backend answers from typed fixtures (`src/mocks/fixtures.ts`) validated by the same contract schemas as live responses. Sign-in accounts, join references and card tokens that reach every state are listed in `src/mocks/README.md`. The same scenario suite (`src/mocks/services.test.ts`) runs against the in-process mock **and** the real HTTP transport over mock responses, which is what guarantees they stay interchangeable. Mock code is imported dynamically on the server only; `npm run check:bundle` fails the build if mock data or server configuration ever appears in browser JavaScript.

## Adding a feature service

1. Add `src/features/<feature>/api.ts` exporting `createXApi(transport)`; type inputs with `RequestBody<...>` / `Schemas[...]`.
2. If the spec is vague for the response, add a schema to `contract/index.ts` (tag it `OPENAPI-GAP`) and pass `parse: parseWith(schema)`.
3. Register it in `lib/api/index.ts`.
4. Add mock handlers in `src/mocks/handlers.ts` and scenarios to `services.test.ts`.
5. State-changing operations: require an `idempotencyKey` argument if the backend does.
