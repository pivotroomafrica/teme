import { createHandlers } from "@/mocks/handlers";
import { createMockState, type MockState } from "@/mocks/handlers";

/**
 * A fetch() that answers from the mock handlers as real HTTP responses (status codes, headers, JSON). It lets
 * tests drive the REAL transport and services against the mock backend, which proves the mock and live code
 * paths behave identically.
 */
export function createMockFetch(state: MockState = createMockState()) {
  const routes = createHandlers().map((route) => ({
    route,
    regex: new RegExp(`^${route.path.replace(/\{(\w+)\}/g, "(?<$1>[^/]+)")}$`),
  }));

  const fetchLike = async (
    input: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = new URL(String(input));
    const path = decodeURIComponent(url.pathname.replace(/^\/api\/v1/, ""));
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const found = routes.find(({ route, regex }) => route.method === method && regex.test(path));
    if (!found) {
      return new Response(
        JSON.stringify({ error: { code: "NOT_FOUND", message: "no route", requestId: "r" } }),
        {
          status: 404,
          headers: { "content-type": "application/json" },
        },
      );
    }
    const authorization = headers.get("authorization");
    const reply = await found.route.handle({
      params: { ...(found.regex.exec(path)?.groups ?? {}) },
      query: Object.fromEntries(url.searchParams),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      token: authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined,
      idempotencyKey: headers.get("idempotency-key") ?? undefined,
      state,
    });
    if (reply.status === 204 || reply.body === undefined) {
      return new Response(null, { status: reply.status, headers: reply.headers });
    }
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  return { fetch: fetchLike as typeof fetch, state };
}
