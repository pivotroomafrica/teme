import { NextRequest, type NextResponse } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRefreshFlights } from "@/lib/auth/refresh";
import { seal, unseal } from "@/lib/auth/seal";
import { SESSION_COOKIE, type SessionData } from "@/lib/auth/session-data";
import { MOCK_BRANCHES, MOCK_PASSWORD } from "@/mocks/fixtures";

const SECRET = "Zq8vN3tK1xW6pL9sD2fG5hJ7mB4cR0yU";
const ORIGIN = "http://localhost:3001";

type Handler = (request: NextRequest, context?: never) => Promise<NextResponse> | NextResponse;
const routes: Record<string, Record<string, Handler>> = {};

beforeAll(async () => {
  vi.stubEnv("TC_SESSION_SECRET", SECRET);
  vi.stubEnv("TC_API_MODE", "mock");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  routes.login = await import("./session/login/route");
  routes.logout = await import("./session/logout/route");
  routes.logoutAll = await import("./session/logout-all/route");
  routes.refresh = await import("./session/refresh/route");
  routes.end = await import("./session/end/route");
  routes.branch = await import("./session/branch/route");
});

beforeEach(() => {
  (globalThis as Record<symbol, unknown>)[Symbol.for("temelashcard.mockState")] = undefined;
  resetRefreshFlights();
});

const CSRF = { "x-requested-with": "tc-web", origin: ORIGIN, "sec-fetch-site": "same-origin" };

function post(
  path: string,
  body: unknown,
  init: { headers?: Record<string, string>; cookie?: string } = {},
) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...CSRF,
      ...init.headers,
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const get = (path: string, init: { headers?: Record<string, string>; cookie?: string } = {}) =>
  new NextRequest(`${ORIGIN}${path}`, {
    headers: { ...init.headers, ...(init.cookie ? { cookie: init.cookie } : {}) },
  });

async function signIn(email: string, next?: string) {
  const response = await routes.login!.POST!(
    post("/api/session/login", { email, password: MOCK_PASSWORD, next, locale: "en" }),
  );
  const cookie = response.cookies.get(SESSION_COOKIE)?.value;
  return { response, cookie, header: cookie ? `${SESSION_COOKIE}=${cookie}` : undefined };
}

const open = async (cookie: string) => (await unseal<SessionData>(cookie, SECRET))!;
const reseal = (data: SessionData) => seal(data, SECRET);

describe("POST /api/session/login", () => {
  it("signs in and sets a sealed, HttpOnly cookie, without exposing any token", async () => {
    const { response, cookie } = await signIn("owner@mock.test");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      redirectTo: "/en/dashboard",
      user: { displayName: "Hana Owner", role: "OWNER" },
    });
    expect(JSON.stringify(body)).not.toMatch(/mock-access|mock-refresh|Token/);
    expect(cookie).toMatch(/^v1\./);
    expect(cookie).not.toContain("mock-access");
    const header = response.headers.get("set-cookie")!.toLowerCase();
    expect(header).toContain("httponly");
    expect(header).toContain("samesite=lax");
    expect(header).toContain("path=/");
    expect(header).toContain(`max-age=${30 * 86400}`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    // The tokens are inside the seal, and only the server can read them.
    expect((await open(cookie!)).user).toMatchObject({ role: "OWNER", kind: "merchant" });
  });

  it("sends each role to its own home page", async () => {
    const homes: Array<[string, string]> = [
      ["owner@mock.test", "/en/dashboard"],
      ["manager@mock.test", "/en/dashboard"],
      ["staff@mock.test", "/en/staff/scanner"],
      ["admin@mock.test", "/en/operations"],
    ];
    for (const [email, home] of homes) {
      expect((await (await signIn(email)).response.json()).redirectTo, email).toBe(home);
    }
  });

  it("returns people to the page they wanted, when they are allowed there", async () => {
    expect(
      (await (await signIn("owner@mock.test", "/en/dashboard/analytics?range=30")).response.json())
        .redirectTo,
    ).toBe("/en/dashboard/analytics?range=30");
    expect(
      (await (await signIn("owner@mock.test", "/am/dashboard/team")).response.json()).redirectTo,
    ).toBe("/am/dashboard/team");
  });

  it("ignores a destination that is unsafe or not permitted for the account", async () => {
    for (const next of [
      "//evil.example",
      "https://evil.example",
      "/\\evil.example",
      "/en/operations",
      "/login",
      "javascript:alert(1)",
    ]) {
      expect((await (await signIn("owner@mock.test", next)).response.json()).redirectTo, next).toBe(
        "/en/dashboard",
      );
    }
    expect(
      (await (await signIn("staff@mock.test", "/en/dashboard")).response.json()).redirectTo,
    ).toBe("/en/staff/scanner");
  });

  it("answers every wrong credential identically and sets no cookie", async () => {
    const wrongPassword = await routes.login!.POST!(
      post("/api/session/login", { email: "owner@mock.test", password: "nope", locale: "en" }),
    );
    const unknown = await routes.login!.POST!(
      post("/api/session/login", {
        email: "ghost@mock.test",
        password: MOCK_PASSWORD,
        locale: "en",
      }),
    );
    for (const r of [wrongPassword, unknown]) {
      expect(r.status).toBe(401);
      expect(r.cookies.get(SESSION_COOKIE)).toBeUndefined();
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    const [a, b] = [await wrongPassword.json(), await unknown.json()];
    expect(a.error.code).toBe("INVALID_CREDENTIALS");
    expect({ code: a.error.code, message: a.error.message }).toEqual({
      code: b.error.code,
      message: b.error.message,
    });
  });

  it("passes rate limiting on, with the wait time", async () => {
    const r = await routes.login!.POST!(
      post("/api/session/login", { email: "busy@mock.test", password: MOCK_PASSWORD }),
    );
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("30");
  });

  it("rejects malformed bodies", async () => {
    for (const body of [
      {},
      { email: "a@b.c" },
      { email: "", password: "x" },
      { email: "x".repeat(300), password: "p" },
      "not an object",
    ]) {
      expect(
        (await routes.login!.POST!(post("/api/session/login", body))).status,
        JSON.stringify(body).slice(0, 30),
      ).toBe(400);
    }
    const broken = new NextRequest(`${ORIGIN}/api/session/login`, {
      method: "POST",
      headers: { ...CSRF, "content-type": "application/json" },
      body: "{oops",
    });
    expect((await routes.login!.POST!(broken)).status).toBe(400);
  });

  it("refuses cross-site and unmarked requests before touching the backend", async () => {
    const attempts: Array<{ headers: Record<string, string> }> = [
      { headers: { "x-requested-with": "" } },
      { headers: { origin: "https://evil.example" } },
      { headers: { origin: "", "sec-fetch-site": "cross-site" } },
    ];
    for (const attempt of attempts) {
      const r = await routes.login!.POST!(
        post("/api/session/login", { email: "owner@mock.test", password: MOCK_PASSWORD }, attempt),
      );
      expect(r.status).toBe(403);
      expect(r.cookies.get(SESSION_COOKIE)).toBeUndefined();
    }
  });
});

describe("POST /api/session/logout and logout-all", () => {
  it("ends the session and clears the cookie", async () => {
    const { header } = await signIn("staff@mock.test");
    const r = await routes.logout!.POST!(post("/api/session/logout", {}, { cookie: header }));
    expect(r.status).toBe(204);
    expect(r.cookies.get(SESSION_COOKIE)?.value).toBe("");
    expect(r.headers.get("set-cookie")!.toLowerCase()).toContain("max-age=0");
  });

  it("works without a session too, and still refuses cross-site requests", async () => {
    expect((await routes.logout!.POST!(post("/api/session/logout", {}))).status).toBe(204);
    const cross = await routes.logout!.POST!(
      post("/api/session/logout", {}, { headers: { origin: "https://evil.example" } }),
    );
    expect(cross.status).toBe(403);
  });

  it("logs out of all devices for a signed-in account and clears the cookie", async () => {
    const { header } = await signIn("owner@mock.test");
    const r = await routes.logoutAll!.POST!(
      post("/api/session/logout-all", {}, { cookie: header }),
    );
    expect(r.status).toBe(204);
    expect(r.cookies.get(SESSION_COOKIE)?.value).toBe("");
  });

  it("revokes every refresh token of the account", async () => {
    const first = await signIn("owner@mock.test");
    const second = await signIn("owner@mock.test");
    await routes.logoutAll!.POST!(post("/api/session/logout-all", {}, { cookie: first.header }));
    // The other browser can no longer refresh: its session is over.
    const stale = { ...(await open(second.cookie!)), accessExpiresAt: Date.now() - 1000 };
    const r = await routes.refresh.GET!(
      get("/api/session/refresh?locale=en&next=/en/dashboard", {
        cookie: `${SESSION_COOKIE}=${await reseal(stale)}`,
      }),
    );
    expect(new URL(r.headers.get("location")!).pathname).toBe("/en/session-expired");
  });

  it("answers 401 and clears the cookie when there is no valid session", async () => {
    const r = await routes.logoutAll!.POST!(post("/api/session/logout-all", {}));
    expect(r.status).toBe(401);
  });
});

describe("GET /api/session/refresh", () => {
  const location = (r: NextResponse) => {
    const url = new URL(r.headers.get("location")!);
    return url.pathname + url.search;
  };

  async function staleCookie(email = "owner@mock.test") {
    const { cookie } = await signIn(email);
    const data = await open(cookie!);
    return {
      data,
      header: `${SESSION_COOKIE}=${await reseal({ ...data, accessExpiresAt: Date.now() - 1000 })}`,
    };
  }

  it("renews the tokens, keeps the original sign-in time, and returns to the page", async () => {
    const { data, header } = await staleCookie();
    const r = await routes.refresh.GET!(
      get("/api/session/refresh?locale=en&next=/en/dashboard/analytics", { cookie: header }),
    );
    expect(r.status).toBe(307);
    expect(location(r)).toBe("/en/dashboard/analytics");
    const renewed = await open(r.cookies.get(SESSION_COOKIE)!.value);
    expect(renewed.refreshToken).not.toBe(data.refreshToken);
    expect(renewed.accessExpiresAt).toBeGreaterThan(Date.now() + 800_000);
    expect(renewed.issuedAt).toBe(data.issuedAt);
  });

  it("calls the backend once when two requests refresh at the same moment, so the session survives", async () => {
    const { header } = await staleCookie();
    const request = () =>
      routes.refresh.GET!(
        get("/api/session/refresh?locale=en&next=/en/dashboard", { cookie: header }),
      );
    const [a, b] = await Promise.all([request(), request()]);
    const [ca, cb] = [
      await open(a.cookies.get(SESSION_COOKIE)!.value),
      await open(b.cookies.get(SESSION_COOKIE)!.value),
    ];
    expect(ca.refreshToken).toBe(cb.refreshToken);
    // And a third, late request that still carries the old cookie gets the same new session, not a replay.
    const late = await request();
    expect((await open(late.cookies.get(SESSION_COOKIE)!.value)).refreshToken).toBe(
      ca.refreshToken,
    );
  });

  it("ends the session when the backend refuses the refresh token", async () => {
    const { data } = await staleCookie();
    const forged = await reseal({
      ...data,
      refreshToken: "mock-refresh.owner@mock.test.revoked",
      accessExpiresAt: Date.now() - 1,
    });
    const r = await routes.refresh.GET!(
      get("/api/session/refresh?locale=am&next=/am/dashboard", {
        cookie: `${SESSION_COOKIE}=${forged}`,
      }),
    );
    expect(location(r)).toBe("/am/session-expired?reason=expired");
    expect(r.cookies.get(SESSION_COOKIE)?.value).toBe("");
  });

  it("sends visitors without a session to sign in, remembering the destination", async () => {
    const r = await routes.refresh.GET!(
      get("/api/session/refresh?locale=en&next=/en/dashboard/team"),
    );
    expect(location(r)).toBe(`/en/login?next=${encodeURIComponent("/en/dashboard/team")}`);
  });

  it("never redirects to another site", async () => {
    const { header } = await staleCookie();
    for (const next of ["//evil.example", "https://evil.example/x", "/\\evil.example"]) {
      const r = await routes.refresh.GET!(
        get(`/api/session/refresh?locale=en&next=${encodeURIComponent(next)}`, { cookie: header }),
      );
      expect(location(r), next).toBe("/en");
    }
  });

  it("does not act on a request another site triggered", async () => {
    const { header } = await staleCookie();
    const r = await routes.refresh.GET!(
      get("/api/session/refresh?locale=en&next=/en/dashboard", {
        cookie: header,
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(location(r)).toBe("/en/login");
    expect(r.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
});

describe("GET /api/session/end", () => {
  it("clears the cookie and explains why, accepting only known reasons", async () => {
    const r = await routes.end.GET!(get("/api/session/end?reason=revoked&locale=am"));
    expect(
      new URL(r.headers.get("location")!).pathname + new URL(r.headers.get("location")!).search,
    ).toBe("/am/session-expired?reason=revoked");
    expect(r.cookies.get(SESSION_COOKIE)?.value).toBe("");
    const odd = await routes.end.GET!(get("/api/session/end?reason=%3Cscript%3E&locale=xx"));
    expect(new URL(odd.headers.get("location")!).search).toBe("?reason=expired");
    expect(new URL(odd.headers.get("location")!).pathname).toBe("/en/session-expired");
  });

  it("ignores requests another website triggered", async () => {
    const r = await routes.end.GET!(
      get("/api/session/end?reason=expired", { headers: { "sec-fetch-site": "cross-site" } }),
    );
    expect(new URL(r.headers.get("location")!).pathname).toBe("/en/login");
    expect(r.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
});

describe("POST /api/session/branch", () => {
  const branchId = MOCK_BRANCHES[1]!.id;

  it("remembers a branch the account is allowed to use, in an HttpOnly cookie", async () => {
    const { header } = await signIn("staff@mock.test");
    const r = await routes.branch!.POST!(
      post("/api/session/branch", { branchId }, { cookie: header }),
    );
    expect(r.status).toBe(204);
    expect(r.cookies.get("tc_branch")?.value).toBe(branchId);
    expect(r.headers.get("set-cookie")!.toLowerCase()).toContain("httponly");
  });

  it("refuses unknown branches without saying whether they exist", async () => {
    const { header } = await signIn("staff@mock.test");
    for (const id of [
      "00000000-0000-4000-8000-0000000b9999",
      "11111111-1111-4111-8111-111111111111",
    ]) {
      const r = await routes.branch!.POST!(
        post("/api/session/branch", { branchId: id }, { cookie: header }),
      );
      expect(r.status).toBe(404);
      expect(r.cookies.get("tc_branch")).toBeUndefined();
    }
  });

  it("validates input, requires a session and refuses cross-site requests", async () => {
    const { header } = await signIn("staff@mock.test");
    expect(
      (
        await routes.branch!.POST!(
          post("/api/session/branch", { branchId: "not-a-uuid" }, { cookie: header }),
        )
      ).status,
    ).toBe(400);
    expect((await routes.branch!.POST!(post("/api/session/branch", { branchId }))).status).toBe(
      401,
    );
    const cross = await routes.branch!.POST!(
      post(
        "/api/session/branch",
        { branchId },
        { cookie: header, headers: { origin: "https://evil.example" } },
      ),
    );
    expect(cross.status).toBe(403);
  });
});
