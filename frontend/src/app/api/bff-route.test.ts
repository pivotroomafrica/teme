import { NextRequest, type NextResponse } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRefreshFlights } from "@/lib/auth/refresh";
import { seal, unseal } from "@/lib/auth/seal";
import { SESSION_COOKIE, type SessionData } from "@/lib/auth/session-data";
import { MOCK_BRANCHES, MOCK_PASSWORD } from "@/mocks/fixtures";

const SECRET = "Zq8vN3tK1xW6pL9sD2fG5hJ7mB4cR0yU";
const ORIGIN = "http://localhost:3001";
const BRANCH = MOCK_BRANCHES[0]!.id;

type BffHandler = (
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) => Promise<NextResponse>;
let bff: Record<string, BffHandler>;
let login: { POST: (r: NextRequest) => Promise<NextResponse> };

beforeAll(async () => {
  vi.stubEnv("TC_SESSION_SECRET", SECRET);
  vi.stubEnv("TC_API_MODE", "mock");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  bff = (await import("./bff/[...path]/route")) as unknown as Record<string, BffHandler>;
  login = await import("./session/login/route");
});

beforeEach(() => {
  (globalThis as Record<symbol, unknown>)[Symbol.for("temelashcard.mockState")] = undefined;
  resetRefreshFlights();
});

const CSRF = { "x-requested-with": "tc-web", origin: ORIGIN, "sec-fetch-site": "same-origin" };

interface Call {
  method?: string;
  path: string;
  body?: unknown;
  rawBody?: string;
  cookie?: string;
  headers?: Record<string, string>;
  csrf?: boolean;
}

function call({ method = "GET", path, body, rawBody, cookie, headers, csrf = true }: Call) {
  const [pathname, query] = path.split("?");
  const request = new NextRequest(`${ORIGIN}/api/bff${pathname}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      ...(csrf ? CSRF : {}),
      ...(body !== undefined || rawBody !== undefined
        ? { "content-type": "application/json" }
        : {}),
      ...headers,
      ...(cookie ? { cookie } : {}),
    },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const segments = pathname!.split("/").filter(Boolean);
  return bff[method]!(request, { params: Promise.resolve({ path: segments }) });
}

async function session(email: string) {
  const r = await login.POST(
    new NextRequest(`${ORIGIN}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json", ...CSRF },
      body: JSON.stringify({ email, password: MOCK_PASSWORD, locale: "en" }),
    }),
  );
  const value = r.cookies.get(SESSION_COOKIE)!.value;
  return { value, header: `${SESSION_COOKIE}=${value}` };
}

const open = async (value: string) => (await unseal<SessionData>(value, SECRET))!;

describe("public customer flows (no session)", () => {
  it("loads join information", async () => {
    const r = await call({ path: "/join/sample-cafe" });
    expect(r.status).toBe(200);
    expect((await r.json()).program.stampsRequired).toBe(8);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("enrolls with the backend's status code (201) and no cookie", async () => {
    const r = await call({
      method: "POST",
      path: "/join/sample-cafe/enroll",
      body: { phone: "0911234567", firstName: "Abebe", preferredLanguage: "AM", acceptTerms: true },
    });
    expect(r.status).toBe(201);
    expect((await r.json()).status).toBe("CREATED");
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("relays backend errors in the standard envelope, with status and Retry-After", async () => {
    const gone = await call({ path: "/join/no-such-merchant" });
    expect(gone.status).toBe(404);
    expect((await gone.json()).error.code).toBe("NOT_FOUND");
    const busy = await call({ path: "/join/busy" });
    expect(busy.status).toBe(429);
    expect(busy.headers.get("retry-after")).toBe("20");
    const bad = await call({
      method: "POST",
      path: "/join/sample-cafe/enroll",
      body: { phone: "1", firstName: "", acceptTerms: false },
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.details).toContain("firstName should not be empty");
  });

  it("passes 204 answers through without a body", async () => {
    const r = await call({
      method: "POST",
      path: "/card/consent/marketing/withdraw",
      body: { cardToken: "mock-ok-1" },
    });
    expect(r.status).toBe(204);
    expect(await r.text()).toBe("");
  });

  it("serves the customer card by its token in the body, never in a URL", async () => {
    const r = await call({ method: "POST", path: "/card/web", body: { cardToken: "mock-reward" } });
    expect(r.status).toBe(200);
    expect((await r.json()).rewardsAvailable).toBe(1);
  });
});

describe("signed-in routes", () => {
  it("needs a session", async () => {
    for (const path of [
      "/merchant/branches",
      "/auth/me",
      "/scanner/validate",
      "/platform/outbox/stats",
    ]) {
      const r = await call({
        method: path === "/scanner/validate" ? "POST" : "GET",
        path,
        body: path === "/scanner/validate" ? {} : undefined,
      });
      expect(r.status, path).toBe(401);
    }
  });

  it("adds the bearer token itself, so the browser never holds one", async () => {
    const { header } = await session("staff@mock.test");
    const r = await call({ path: "/merchant/branches", cookie: header });
    expect(r.status).toBe(200);
    expect(await r.json()).toHaveLength(2);
    expect(r.headers.get("set-cookie")).toBeNull(); // nothing changed, nothing re-sent
    expect(JSON.stringify(Object.fromEntries(r.headers))).not.toMatch(/mock-access|authorization/i);
  });

  it("forwards the backend's 403 when the account may not do this", async () => {
    const { header } = await session("admin@mock.test");
    const r = await call({
      method: "POST",
      path: "/scanner/validate",
      body: { cardToken: "mock-ok-1", branchId: BRANCH },
      cookie: header,
    });
    expect(r.status).toBe(403);
    expect(r.cookies.get(SESSION_COOKIE)).toBeUndefined(); // forbidden is not signed-out
  });

  it("scans and stamps through the proxy, with idempotent replay", async () => {
    const { header } = await session("staff@mock.test");
    const stamp = (key: string) =>
      call({
        method: "POST",
        path: "/scanner/stamps",
        body: { cardToken: "mock-ok-p", branchId: BRANCH },
        cookie: header,
        headers: { "idempotency-key": key },
      });
    const first = await (await stamp("bff-key-0001")).json();
    const replay = await (await stamp("bff-key-0001")).json();
    expect(first).toMatchObject({ outcome: "STAMPED", replayed: false, progress: { current: 3 } });
    expect(replay).toMatchObject({ outcome: "STAMPED", replayed: true, progress: { current: 3 } });
    const other = await stamp("bff-key-0002");
    expect((await other.json()).progress.current).toBe(4);
  });

  it("refuses a malformed idempotency key before anything is sent", async () => {
    const { header } = await session("staff@mock.test");
    const r = await call({
      method: "POST",
      path: "/scanner/stamps",
      body: {},
      cookie: header,
      headers: { "idempotency-key": "short" },
    });
    expect(r.status).toBe(400);
  });

  it("refreshes an expiring token on the way and stores the new session", async () => {
    const { value } = await session("owner@mock.test");
    const data = await open(value);
    const stale = `${SESSION_COOKIE}=${await seal({ ...data, accessExpiresAt: Date.now() - 1000 }, SECRET)}`;
    const r = await call({ path: "/auth/me", cookie: stale });
    expect(r.status).toBe(200);
    const renewed = await open(r.cookies.get(SESSION_COOKIE)!.value);
    expect(renewed.refreshToken).not.toBe(data.refreshToken);
    expect(renewed.issuedAt).toBe(data.issuedAt);
  });

  it("drops the cookie when the backend refuses the session", async () => {
    const { value } = await session("owner@mock.test");
    const data = await open(value);
    const revoked = `${SESSION_COOKIE}=${await seal({ ...data, accessToken: "mock-access.ghost@mock.test" }, SECRET)}`;
    const r = await call({ path: "/auth/me", cookie: revoked });
    expect(r.status).toBe(401);
    expect(r.cookies.get(SESSION_COOKIE)?.value).toBe("");
  });

  it("treats a forged or foreign cookie as no session", async () => {
    const foreign = `${SESSION_COOKIE}=${await seal({ v: 1 }, "another-secret-another-secret-123456")}`;
    expect((await call({ path: "/merchant/branches", cookie: foreign })).status).toBe(401);
    expect(
      (await call({ path: "/merchant/branches", cookie: `${SESSION_COOKIE}=junk` })).status,
    ).toBe(401);
  });
});

describe("what the proxy refuses", () => {
  it("never forwards sign-in, refresh, sign-out or internal backend routes", async () => {
    for (const [method, path] of [
      ["POST", "/auth/login"],
      ["POST", "/auth/refresh"],
      ["POST", "/auth/logout"],
      ["POST", "/auth/logout-all"],
      ["GET", "/health"],
      ["GET", "/wallet/apple/v1/log"],
      ["GET", "/unknown/thing"],
    ] as const) {
      const r = await call({ method, path, body: method === "POST" ? {} : undefined });
      expect(r.status, `${method} ${path}`).toBe(404);
    }
  });

  it("refuses traversal and smuggled segments", async () => {
    const { header } = await session("owner@mock.test");
    for (const path of [
      "/merchant/../auth/login",
      "/merchant/%2e%2e/auth",
      "/merchant/a%2Fb",
      "/merchant/x%00",
    ]) {
      const r = await call({ path, cookie: header });
      expect(r.status, path).toBe(404);
    }
  });

  it("refuses state-changing requests that are not provably from this site", async () => {
    const { header } = await session("staff@mock.test");
    const body = { cardToken: "mock-ok-x", branchId: BRANCH };
    const key = { "idempotency-key": "bff-key-9999" };
    expect(
      (
        await call({
          method: "POST",
          path: "/scanner/stamps",
          body,
          cookie: header,
          headers: key,
          csrf: false,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call({
          method: "POST",
          path: "/scanner/stamps",
          body,
          cookie: header,
          headers: { ...key, origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call({
          method: "POST",
          path: "/scanner/stamps",
          body,
          cookie: header,
          headers: { ...key, origin: "", "sec-fetch-site": "cross-site" },
        })
      ).status,
    ).toBe(403);
    // Nothing was stamped by the refused attempts.
    const ok = await call({
      method: "POST",
      path: "/scanner/stamps",
      body,
      cookie: header,
      headers: key,
    });
    expect((await ok.json()).progress.current).toBe(3);
  });

  it("rejects unparsable and oversized bodies", async () => {
    const { header } = await session("staff@mock.test");
    expect(
      (await call({ method: "POST", path: "/scanner/validate", rawBody: "{oops", cookie: header }))
        .status,
    ).toBe(400);
    const big = JSON.stringify({ cardToken: "x".repeat(300_000) });
    expect(
      (await call({ method: "POST", path: "/scanner/validate", rawBody: big, cookie: header }))
        .status,
    ).toBe(413);
  });
});
