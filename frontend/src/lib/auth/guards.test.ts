import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionFor } from "@/mocks/fixtures";
import { resolveBffRoute } from "./bff-routes";
import { checkCsrf, isCrossSiteNavigation } from "./csrf";
import { refreshSessionData, resetRefreshFlights, type RefreshDeps } from "./refresh";
import { sessionFromLogin } from "./session-data";

const headers = (init: Record<string, string>) => new Headers(init);
const ORIGINS = ["https://app.example.org"];

describe("checkCsrf", () => {
  const post = (h: Record<string, string>, method = "POST") =>
    checkCsrf({ method, headers: headers(h), allowedOrigins: ORIGINS });

  it("lets safe methods through without evidence", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) expect(post({}, method).ok).toBe(true);
  });

  it("accepts a marked request from this app's origin", () => {
    expect(post({ "x-requested-with": "tc-web", origin: "https://app.example.org" }).ok).toBe(true);
  });

  it("refuses unsafe requests without the marker, whatever else they carry", () => {
    expect(post({ origin: "https://app.example.org" })).toMatchObject({ ok: false });
    expect(
      post({ "x-requested-with": "XMLHttpRequest", origin: "https://app.example.org" }).ok,
    ).toBe(false);
  });

  it("refuses another site's origin even with the marker", () => {
    expect(post({ "x-requested-with": "tc-web", origin: "https://evil.example" })).toEqual({
      ok: false,
      reason: "origin not allowed",
    });
    expect(post({ "x-requested-with": "tc-web", origin: "null" }).ok).toBe(false);
  });

  it("uses Fetch Metadata when there is no Origin header", () => {
    expect(post({ "x-requested-with": "tc-web", "sec-fetch-site": "same-origin" }).ok).toBe(true);
    expect(post({ "x-requested-with": "tc-web", "sec-fetch-site": "cross-site" }).ok).toBe(false);
    expect(post({ "x-requested-with": "tc-web", "sec-fetch-site": "same-site" }).ok).toBe(false);
  });

  it("refuses requests that cannot prove where they came from (scripts, curl)", () => {
    expect(post({ "x-requested-with": "tc-web" })).toMatchObject({ ok: false });
  });

  it("covers every unsafe method", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"])
      expect(post({}, method).ok).toBe(false);
  });

  it("flags cross-site navigations for the GET sign-out endpoint", () => {
    expect(isCrossSiteNavigation(headers({ "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(isCrossSiteNavigation(headers({ "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isCrossSiteNavigation(headers({}))).toBe(false);
  });
});

describe("resolveBffRoute", () => {
  const route = (method: string, path: string) =>
    resolveBffRoute(method, path.split("/").filter(Boolean));

  it("forwards customer flows without a session", () => {
    expect(route("GET", "join/sample-cafe")).toEqual({
      path: "/join/sample-cafe",
      access: "public",
    });
    expect(route("POST", "join/sample-cafe/enroll")?.access).toBe("public");
    expect(route("POST", "card/web")?.access).toBe("public");
    expect(route("POST", "card/wallet/links")?.access).toBe("public");
    expect(route("POST", "card/consent/marketing/withdraw")?.access).toBe("public");
  });

  it("forwards only the invitation acceptance among the account routes", () => {
    expect(route("POST", "auth/invitations/accept")).toEqual({
      path: "/auth/invitations/accept",
      access: "public",
    });
    expect(route("GET", "auth/invitations/accept")).toBeNull();
    expect(route("POST", "auth/login")).toBeNull();
    expect(route("POST", "auth/refresh")).toBeNull();
    expect(route("POST", "auth/invitations/other")).toBeNull();
  });

  it("forwards signed-in areas as private", () => {
    expect(route("POST", "scanner/stamps")).toEqual({ path: "/scanner/stamps", access: "private" });
    expect(
      route("GET", "merchant/customers/0a1b2c3d-0000-4000-8000-000000000001/ledger")?.access,
    ).toBe("private");
    expect(route("PATCH", "merchant/programs/abc")?.access).toBe("private");
    expect(route("GET", "platform/outbox/stats")?.access).toBe("private");
    expect(route("GET", "auth/me")?.access).toBe("private");
  });

  it("never proxies sign-in, refresh or sign-out, which have their own handlers", () => {
    for (const path of ["auth/login", "auth/refresh", "auth/logout", "auth/logout-all"]) {
      expect(route("POST", path), path).toBeNull();
    }
  });

  it("refuses internal and unrelated backend routes", () => {
    for (const path of [
      "health",
      "health/ready",
      "wallet/apple/v1/log",
      "wallet/apple/download/x",
      "metrics",
      "api/v1/auth/me",
    ]) {
      expect(route("GET", path), path).toBeNull();
    }
  });

  it("refuses the wrong method for a public flow", () => {
    expect(route("DELETE", "join/sample-cafe")).toBeNull();
    expect(route("GET", "card/web")).toBeNull();
    expect(route("PUT", "join/x/enroll")).toBeNull();
  });

  it("refuses traversal and smuggling in path segments", () => {
    const bad: string[][] = [
      ["merchant", "..", "auth", "login"],
      ["merchant", ".", "x"],
      ["merchant", "%2e%2e", "auth"],
      ["merchant", "a%2Fb"],
      ["merchant", "a%5Cb"],
      ["merchant", "x y"],
      ["merchant", "x%00"],
      ["merchant", "x?y=1"],
      ["merchant", "x#y"],
      ["merchant", "%E0%A4%A"],
      ["merchant", ""],
      ["merchant", "x;y"],
      ["merchant", "a".repeat(200)],
      [],
      ["merchant", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
    ];
    for (const segments of bad)
      expect(resolveBffRoute("GET", segments), JSON.stringify(segments)).toBeNull();
  });

  it("does not let a ** rule match the bare prefix", () => {
    expect(route("GET", "merchant")).toBeNull();
    expect(route("GET", "scanner")).toBeNull();
  });
});

describe("refreshSessionData", () => {
  const T0 = Date.parse("2026-10-09T10:00:00.000Z");
  const current = sessionFromLogin(sessionFor("staff@mock.test", 1), T0);

  beforeEach(() => resetRefreshFlights());
  afterEach(() => vi.useRealTimers());

  const deps = (refresh: RefreshDeps["refresh"]) => ({ refresh, now: () => T0 + 870_000 });

  it("calls the backend once for simultaneous refreshes of the same token", async () => {
    const refresh = vi.fn(async () => sessionFor("staff@mock.test", 2));
    const results = await Promise.all([
      refreshSessionData(current, deps(refresh)),
      refreshSessionData(current, deps(refresh)),
      refreshSessionData(current, deps(refresh)),
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(current.refreshToken);
    expect(new Set(results.map((r) => r.refreshToken)).size).toBe(1);
    expect(results[0]!.refreshToken).toBe("mock-refresh.staff@mock.test.2");
  });

  it("hands a late request that still has the old cookie the same new session (never replays the old token)", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => sessionFor("staff@mock.test", 2));
    const first = await refreshSessionData(current, deps(refresh));
    await vi.advanceTimersByTimeAsync(10_000);
    const late = await refreshSessionData(current, deps(refresh));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(late.refreshToken).toBe(first.refreshToken);
  });

  it("forgets after the grace period", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => sessionFor("staff@mock.test", 2));
    await refreshSessionData(current, deps(refresh));
    await vi.advanceTimersByTimeAsync(31_000);
    await refreshSessionData(current, deps(refresh));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("shares a failure too, instead of retrying the rotated token", async () => {
    const refresh = vi.fn(async () => {
      throw new Error("401");
    });
    const outcomes = await Promise.allSettled([
      refreshSessionData(current, deps(refresh)),
      refreshSessionData(current, deps(refresh)),
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(["rejected", "rejected"]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps different sessions independent", async () => {
    const other = sessionFromLogin(sessionFor("owner@mock.test", 1), T0);
    const refresh = vi.fn(async (token: string) =>
      token.includes("staff") ? sessionFor("staff@mock.test", 2) : sessionFor("owner@mock.test", 2),
    );
    await Promise.all([
      refreshSessionData(current, deps(refresh)),
      refreshSessionData(other, deps(refresh)),
    ]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("preserves the original sign-in time and computes the new expiry", async () => {
    const refresh = vi.fn(async () => sessionFor("staff@mock.test", 2));
    const next = await refreshSessionData(current, deps(refresh));
    expect(next.issuedAt).toBe(T0);
    expect(next.accessExpiresAt).toBe(T0 + 870_000 + 900_000);
  });
});
