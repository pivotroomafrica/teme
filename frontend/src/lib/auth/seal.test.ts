import { describe, expect, it } from "vitest";
import { seal, unseal } from "./seal";
import {
  ACCESS_REFRESH_SKEW_MS,
  isWithinMaxAge,
  needsRefresh,
  openSession,
  sealSession,
  sessionCookieOptions,
  sessionFromLogin,
} from "./session-data";
import { sessionFor } from "@/mocks/fixtures";

const SECRET = "Zq8vN3tK1xW6pL9sD2fG5hJ7mB4cR0yU";

describe("seal", () => {
  it("round-trips data and hides it", async () => {
    const token = await seal({ accessToken: "super-secret-access", n: 1 }, SECRET);
    expect(token).toMatch(/^v1\.[\w-]+\.[\w-]+$/);
    expect(token).not.toContain("super-secret-access");
    expect(await unseal(token, SECRET)).toEqual({ accessToken: "super-secret-access", n: 1 });
  });

  it("gives a different value each time (random IV)", async () => {
    expect(await seal({ a: 1 }, SECRET)).not.toBe(await seal({ a: 1 }, SECRET));
  });

  it("rejects a wrong secret, any changed byte, and malformed values, without throwing", async () => {
    const token = await seal({ a: 1 }, SECRET);
    expect(await unseal(token, "another-secret-another-secret-123456")).toBeNull();
    const [v, iv, body] = token.split(".") as [string, string, string];
    const flipped = body.slice(0, -2) + (body.endsWith("AA") ? "BB" : "AA");
    expect(await unseal(`${v}.${iv}.${flipped}`, SECRET)).toBeNull();
    expect(await unseal(`${v}.${iv}`, SECRET)).toBeNull();
    expect(await unseal("v2.x.y", SECRET)).toBeNull();
    expect(await unseal("not a token", SECRET)).toBeNull();
    expect(await unseal("", SECRET)).toBeNull();
    expect(await unseal(undefined, SECRET)).toBeNull();
    expect(await unseal("v1.@@@.###", SECRET)).toBeNull();
  });
});

describe("session data", () => {
  const now = Date.parse("2026-10-09T10:00:00.000Z");
  const data = sessionFromLogin(sessionFor("manager@mock.test"), now);

  it("derives expiry and account kind from the login answer", () => {
    expect(data).toMatchObject({
      accessExpiresAt: now + 900_000,
      issuedAt: now,
      user: { role: "MANAGER", kind: "merchant" },
    });
    expect(sessionFromLogin(sessionFor("admin@mock.test"), now).user).toMatchObject({
      kind: "platform",
      merchantId: null,
    });
  });

  it("keeps the original sign-in time across a refresh (absolute limit)", () => {
    expect(sessionFromLogin(sessionFor("manager@mock.test"), now + 1000, now).issuedAt).toBe(now);
  });

  it("asks for a refresh shortly before the access token ends", () => {
    expect(needsRefresh(data, now)).toBe(false);
    expect(needsRefresh(data, data.accessExpiresAt - ACCESS_REFRESH_SKEW_MS - 1)).toBe(false);
    expect(needsRefresh(data, data.accessExpiresAt - ACCESS_REFRESH_SKEW_MS)).toBe(true);
    expect(needsRefresh(data, data.accessExpiresAt + 5000)).toBe(true);
  });

  it("enforces an absolute session lifetime", () => {
    expect(isWithinMaxAge(data, now + 29 * 86_400_000, 30)).toBe(true);
    expect(isWithinMaxAge(data, now + 30 * 86_400_000, 30)).toBe(false);
  });

  it("opens a valid cookie, and refuses forged, expired or wrongly shaped ones", async () => {
    const cookie = await sealSession(data, SECRET);
    expect(await openSession(cookie, SECRET, { now, maxAgeDays: 30 })).toEqual(data);
    expect(
      await openSession(cookie, SECRET, { now: now + 31 * 86_400_000, maxAgeDays: 30 }),
    ).toBeNull();
    expect(
      await openSession(cookie, "wrong-secret-wrong-secret-wrong-12", { now, maxAgeDays: 30 }),
    ).toBeNull();
    const shapeless = await seal({ v: 1, user: {} }, SECRET);
    expect(await openSession(shapeless, SECRET, { now, maxAgeDays: 30 })).toBeNull();
    const roleless = await seal({ ...data, user: { ...data.user, kind: "admin" } }, SECRET);
    expect(await openSession(roleless, SECRET, { now, maxAgeDays: 30 })).toBeNull();
  });

  it("sets safe cookie attributes", () => {
    expect(sessionCookieOptions(30, true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 2_592_000,
    });
    expect(sessionCookieOptions(1, false).secure).toBe(false);
  });
});
