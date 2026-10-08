import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, sealSession, sessionFromLogin } from "@/lib/auth/session-data";
import { seal } from "@/lib/auth/seal";
import { sessionFor, type MockEmail } from "@/mocks/fixtures";

const SECRET = "Zq8vN3tK1xW6pL9sD2fG5hJ7mB4cR0yU";
let proxy: typeof import("./proxy").proxy;

beforeAll(async () => {
  vi.stubEnv("TC_SESSION_SECRET", SECRET);
  vi.stubEnv("TC_API_MODE", "mock");
  ({ proxy } = await import("./proxy"));
});

interface Init {
  cookie?: string;
  lang?: string;
  headers?: Record<string, string>;
}

const request = (path: string, init: Init = {}) =>
  new NextRequest(`http://localhost:3001${path}`, {
    headers: {
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.lang ? { "accept-language": init.lang } : {}),
      ...init.headers,
    },
  });

const target = (res: Response) => {
  const url = new URL(res.headers.get("location")!);
  return url.pathname + url.search;
};

const sessionCookie = async (email: MockEmail, now = Date.now()) =>
  `${SESSION_COOKIE}=${await sealSession(sessionFromLogin(sessionFor(email), now), SECRET)}`;

describe("language routing", () => {
  it("redirects a path without a language to the visitor's language, keeping the query", async () => {
    const res = await proxy(request("/dashboard?tab=x", { lang: "am-ET,am;q=0.9" }));
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/am/dashboard?tab=x");
  });

  it("sends the root to the saved language, defaulting to English", async () => {
    expect(target(await proxy(request("/", { cookie: "tc_locale=am", lang: "en" })))).toBe("/am");
    expect(target(await proxy(request("/")))).toBe("/en");
  });

  it("remembers the language that was actually visited, only when it changed", async () => {
    const res = await proxy(request("/am/join/abc"));
    expect(res.headers.get("set-cookie")).toContain("tc_locale=am");
    expect(res.headers.get("set-cookie")?.toLowerCase()).toContain("samesite=lax");
    expect(
      (await proxy(request("/am", { cookie: "tc_locale=am" }))).headers.get("set-cookie"),
    ).toBeNull();
  });
});

describe("indexing", () => {
  it.each([
    "/login",
    "/card",
    "/wallet",
    "/staff/scanner",
    "/dashboard/team",
    "/operations",
    "/denied",
    "/session-expired",
    "/dev/design-system",
  ])("keeps private area %s out of search engines", async (path) => {
    const email = path.startsWith("/operations") ? "admin@mock.test" : "owner@mock.test";
    const res = await proxy(request(`/en${path}`, { cookie: await sessionCookie(email) }));
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("leaves public pages indexable", async () => {
    expect((await proxy(request("/en"))).headers.get("x-robots-tag")).toBeNull();
    expect((await proxy(request("/en/join/abc"))).headers.get("x-robots-tag")).toBeNull();
  });
});

describe("signed-in areas", () => {
  it("turns away visitors without a session and remembers where they were going", async () => {
    for (const path of ["/en/dashboard", "/en/staff/scanner", "/en/operations/fraud"]) {
      const res = await proxy(request(path));
      expect(res.status, path).toBe(307);
      expect(target(res)).toBe(`/en/login?next=${encodeURIComponent(path)}`);
    }
    const am = await proxy(request("/am/dashboard/team?page=2"));
    expect(target(am)).toBe(`/am/login?next=${encodeURIComponent("/am/dashboard/team?page=2")}`);
  });

  it("lets a merchant account into the dashboard and the scanner", async () => {
    for (const email of ["owner@mock.test", "manager@mock.test", "staff@mock.test"] as const) {
      const cookie = await sessionCookie(email);
      for (const path of ["/en/dashboard", "/en/staff/scanner"]) {
        const res = await proxy(request(path, { cookie }));
        expect(res.headers.get("location"), `${email} ${path}`).toBeNull();
      }
    }
  });

  it("keeps merchant accounts out of operations and platform accounts out of merchant areas", async () => {
    const merchant = await sessionCookie("owner@mock.test");
    const platform = await sessionCookie("admin@mock.test");
    expect(target(await proxy(request("/en/operations", { cookie: merchant })))).toBe("/en/denied");
    expect(target(await proxy(request("/am/operations/audit", { cookie: merchant })))).toBe(
      "/am/denied",
    );
    expect(target(await proxy(request("/en/dashboard", { cookie: platform })))).toBe("/en/denied");
    expect(target(await proxy(request("/en/staff/scanner", { cookie: platform })))).toBe(
      "/en/denied",
    );
    expect(
      (await proxy(request("/en/operations", { cookie: platform }))).headers.get("location"),
    ).toBeNull();
  });

  it("treats forged, tampered, wrongly keyed and over-age cookies as signed out", async () => {
    const good = await sessionCookie("owner@mock.test");
    const bad = [
      `${SESSION_COOKIE}=garbage`,
      `${SESSION_COOKIE}=${await seal({ v: 1, user: { kind: "platform" } }, SECRET)}`,
      `${SESSION_COOKIE}=${await sealSession(sessionFromLogin(sessionFor("admin@mock.test"), Date.now()), "another-secret-another-secret-12345")}`,
      good.slice(0, -3) + "xyz",
      await sessionCookie("owner@mock.test", Date.now() - 31 * 86_400_000),
    ];
    for (const cookie of bad) {
      const res = await proxy(request("/en/operations", { cookie }));
      expect(target(res), cookie.slice(0, 30)).toMatch(/^\/en\/login\?next=/);
    }
  });

  it("does not guard public customer pages", async () => {
    for (const path of ["/en", "/en/join/sample-cafe", "/en/card", "/en/login", "/en/denied"]) {
      expect((await proxy(request(path))).headers.get("location"), path).toBeNull();
    }
  });
});

describe("requested path header", () => {
  it("tells pages which path (and query) was requested", async () => {
    const res = await proxy(request("/en/join/abc?x=1"));
    expect(res.headers.get("x-middleware-request-x-tc-path")).toBe("/en/join/abc?x=1");
  });

  it("replaces a value the client tried to supply", async () => {
    const res = await proxy(request("/en/join/abc", { headers: { "x-tc-path": "/evil" } }));
    expect(res.headers.get("x-middleware-request-x-tc-path")).toBe("/en/join/abc");
  });
});
