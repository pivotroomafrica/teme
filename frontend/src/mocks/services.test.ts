import { describe, expect, it } from "vitest";
import { createApi, newIdempotencyKey } from "@/lib/api";
import {
  enrollmentResultSchema,
  joinInfoSchema,
  meSchema,
  scanResultSchema,
  sessionSchema,
  webCardSchema,
} from "@/lib/api/contract";
import { createHttpTransport, type Transport } from "@/lib/api/http";
import { ApiError } from "@/lib/errors/api-error";
import { createMockFetch } from "@tests/helpers/mock-fetch";
import {
  MOCK_ACCOUNTS,
  MOCK_BRANCHES,
  MOCK_CONSENT_VERSION,
  MOCK_JOIN_INFO,
  MOCK_PASSWORD,
  accessTokenFor,
  meFor,
  sessionFor,
  webCardFor,
  type MockEmail,
} from "./fixtures";
import { createMockState } from "./handlers";
import { createMockTransport } from "./mock-transport";

type Factory = (token?: string) => Transport;

/** The same scenarios run through both transports: they must behave identically. */
const transports: Array<[string, Factory]> = [
  ["in-process mock transport", (token) => createMockTransport({ getAccessToken: () => token })],
  [
    "real HTTP transport over mock responses",
    (token) => {
      const { fetch } = createMockFetch(createMockState());
      return createHttpTransport({
        baseUrl: "https://api.test/api/v1",
        fetch,
        getAccessToken: () => token,
        sleep: async () => undefined,
      });
    },
  ],
];

const fail = async (promise: Promise<unknown>): Promise<ApiError> => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
};

const asStaff = accessTokenFor("staff@mock.test");
const BRANCH = MOCK_BRANCHES[0]!.id;
const enrollBody = {
  phone: "0911234567",
  firstName: "Abebe",
  preferredLanguage: "AM" as const,
  acceptTerms: true,
  consentVersion: MOCK_CONSENT_VERSION,
};

describe("fixtures match the response contract", () => {
  it("accepts every account's session and profile", () => {
    for (const email of Object.keys(MOCK_ACCOUNTS) as MockEmail[]) {
      expect(() => sessionSchema.parse(sessionFor(email))).not.toThrow();
      expect(() => meSchema.parse(meFor(email))).not.toThrow();
    }
  });

  it("accepts the join, card and enrollment shapes", () => {
    expect(() => joinInfoSchema.parse(MOCK_JOIN_INFO)).not.toThrow();
    expect(() =>
      enrollmentResultSchema.parse({
        ...MOCK_JOIN_INFO,
        status: "CREATED",
        customer: { firstName: "A", preferredLanguage: "EN" },
        card: { token: "t" },
      }),
    ).not.toThrow();
    for (const state of [
      { stamps: 3, rewardsAvailable: 0 },
      { stamps: 8, rewardsAvailable: 1 },
      { stamps: 3, rewardsAvailable: 0, status: "SUSPENDED" as const },
    ]) {
      expect(() => webCardSchema.parse(webCardFor("t", state))).not.toThrow();
    }
  });

  it("rejects an answer that breaks the contract (so drift is caught, not rendered)", () => {
    expect(() => scanResultSchema.parse({ outcome: "STAMPED", reason: null })).toThrow();
    expect(() =>
      scanResultSchema.parse({
        outcome: "MAYBE",
        reason: null,
        message: { en: "", am: "" },
        replayed: false,
      }),
    ).toThrow();
    expect(() =>
      sessionSchema.parse({ ...sessionFor("owner@mock.test"), accessToken: "" }),
    ).toThrow();
  });
});

describe.each(transports)("services over the %s", (_name, make) => {
  describe("authentication", () => {
    it("signs every role in with the documented session shape", async () => {
      const api = createApi(make());
      for (const email of Object.keys(MOCK_ACCOUNTS) as MockEmail[]) {
        const session = await api.auth.login({ email, password: MOCK_PASSWORD });
        expect(session).toMatchObject({ tokenType: "Bearer", expiresIn: 900 });
        expect(session.user.role).toBe(MOCK_ACCOUNTS[email].role);
      }
    });

    it("answers every wrong credential the same way", async () => {
      const api = createApi(make());
      const wrongPassword = await fail(
        api.auth.login({ email: "owner@mock.test", password: "nope" }),
      );
      const unknown = await fail(
        api.auth.login({ email: "ghost@mock.test", password: MOCK_PASSWORD }),
      );
      expect(wrongPassword).toMatchObject({ kind: "unauthenticated", code: "INVALID_CREDENTIALS" });
      expect(unknown.code).toBe(wrongPassword.code);
      expect(unknown.message).toBe(wrongPassword.message);
    });

    it("reports rate limiting with the wait time and field problems for an empty form", async () => {
      const api = createApi(make());
      const busy = await fail(api.auth.login({ email: "busy@mock.test", password: MOCK_PASSWORD }));
      expect(busy).toMatchObject({ kind: "rate_limited", retryAfterSeconds: 30 });
      const empty = await fail(api.auth.login({ email: "", password: "" }));
      expect(empty.kind).toBe("validation");
      expect(Object.keys(empty.fieldErrors)).toEqual(["email", "password"]);
    });

    it("rotates refresh tokens, and ends the session if an old one is replayed", async () => {
      const api = createApi(make());
      const first = await api.auth.login({ email: "owner@mock.test", password: MOCK_PASSWORD });
      const second = await api.auth.refresh(first.refreshToken);
      expect(second.refreshToken).not.toBe(first.refreshToken);
      const replay = await fail(api.auth.refresh(first.refreshToken));
      expect(replay.kind).toBe("unauthenticated");
      // The replay revoked the whole family, including the newest token.
      expect((await fail(api.auth.refresh(second.refreshToken))).kind).toBe("unauthenticated");
    });

    it("knows who is signed in, and refuses anonymous callers", async () => {
      const me = await createApi(make(accessTokenFor("manager@mock.test"))).auth.me();
      expect(me).toMatchObject({ kind: "merchant", role: "MANAGER", branchScope: "ALL" });
      expect(me.permissions).toContain("analytics:read");
      expect(me.permissions).not.toContain("privacy:manage");
      expect((await fail(createApi(make()).auth.me())).kind).toBe("unauthenticated");
      expect((await fail(createApi(make("garbage")).auth.me())).kind).toBe("unauthenticated");
    });

    it("logs out without needing to know whether the token was valid", async () => {
      await expect(createApi(make()).auth.logout("whatever")).resolves.toBeUndefined();
    });
  });

  describe("public enrollment", () => {
    it("loads join information", async () => {
      const info = await createApi(make()).enrollment.getJoinInfo("sample-cafe");
      expect(info.program.stampsRequired).toBe(8);
      expect(info.wallet.find((w) => w.provider === "WEB")?.available).toBe(true);
    });

    it("treats unknown, busy and unavailable links distinctly for the UI but never leaks detail", async () => {
      const api = createApi(make());
      expect((await fail(api.enrollment.getJoinInfo("no-such-merchant"))).kind).toBe("not_found");
      expect((await fail(api.enrollment.getJoinInfo("busy"))).kind).toBe("rate_limited");
      expect((await fail(api.enrollment.getJoinInfo("down"))).kind).toBe("unavailable");
    });

    it("issues a card once, then reports the member as existing without a new token", async () => {
      const api = createApi(make());
      const created = await api.enrollment.enroll("sample-cafe", enrollBody);
      expect(created.status).toBe("CREATED");
      expect(created.card?.token).toMatch(/^mock-ok-/);
      const again = await api.enrollment.enroll("sample-cafe", enrollBody);
      expect(again).toMatchObject({ status: "EXISTING", card: null });
      // The echo is what was submitted, never stored data.
      expect(again.customer.firstName).toBe("Abebe");
    });

    it("recognises existing members by number whatever the format", async () => {
      const api = createApi(make());
      const result = await api.enrollment.enroll("sample-cafe", {
        ...enrollBody,
        phone: "+251 91 100 0000",
      });
      expect(result.status).toBe("EXISTING");
    });

    it("maps validation problems to the fields they belong to", async () => {
      const api = createApi(make());
      const error = await fail(
        api.enrollment.enroll("sample-cafe", {
          ...enrollBody,
          firstName: " ",
          phone: "12345",
          acceptTerms: false,
        }),
      );
      expect(error.kind).toBe("validation");
      expect(Object.keys(error.fieldErrors).sort()).toEqual(["acceptTerms", "firstName", "phone"]);
    });

    it("asks the customer to review changed terms", async () => {
      const error = await fail(
        createApi(make()).enrollment.enroll("sample-cafe", {
          ...enrollBody,
          consentVersion: "old",
        }),
      );
      expect(error).toMatchObject({ kind: "conflict", code: "CONSENT_VERSION_STALE" });
    });

    it("does not enrol into an unavailable program", async () => {
      expect(
        (await fail(createApi(make()).enrollment.enroll("paused-program", enrollBody))).kind,
      ).toBe("not_found");
    });
  });

  describe("customer card", () => {
    it("shows progress for a new card created by enrollment", async () => {
      const api = createApi(make());
      const { card } = await api.enrollment.enroll("sample-cafe", {
        ...enrollBody,
        phone: "0922334455",
      });
      const web = await api.card.getWebCard(card!.token);
      expect(web).toMatchObject({
        status: "ACTIVE",
        barcode: card!.token,
        progress: { current: 0, required: 8 },
      });
    });

    it("shows an available reward, a suspended card, and 404 for strangers", async () => {
      const api = createApi(make());
      const reward = await api.card.getWebCard("mock-reward");
      expect(reward.rewardsAvailable).toBe(1);
      expect(reward.reward?.nameEn).toBe("Free coffee");
      expect((await api.card.getWebCard("mock-inactive")).status).toBe("SUSPENDED");
      expect((await fail(api.card.getWebCard("someone-elses-token"))).kind).toBe("not_found");
    });

    it("offers the web card always and wallets only when configured", async () => {
      const api = createApi(make());
      expect(await api.card.createWalletLink("mock-ok-1", "WEB")).toMatchObject({
        kind: "NONE",
        url: null,
      });
      expect((await fail(api.card.createWalletLink("mock-ok-1", "APPLE"))).code).toBe(
        "PROVIDER_NOT_AVAILABLE",
      );
      const google = await api.card.createWalletLink("mock-ok-google", "GOOGLE");
      expect(google).toMatchObject({ kind: "REDIRECT" });
      expect(google.url).toMatch(/^https:/);
    });

    it("withdraws marketing consent", async () => {
      const api = createApi(make());
      await expect(api.card.withdrawMarketingConsent("mock-ok-1")).resolves.toBeUndefined();
      expect((await fail(api.card.withdrawMarketingConsent("nobody"))).kind).toBe("not_found");
    });
  });

  describe("scanner", () => {
    it("is closed to anonymous callers and to platform administrators", async () => {
      expect(
        (
          await fail(
            createApi(make()).scanner.validate({ cardToken: "mock-ok-1", branchId: BRANCH }),
          )
        ).kind,
      ).toBe("unauthenticated");
      const admin = createApi(make(accessTokenFor("admin@mock.test")));
      expect(
        (await fail(admin.scanner.validate({ cardToken: "mock-ok-1", branchId: BRANCH }))).kind,
      ).toBe("forbidden");
    });

    it("validates without changing anything", async () => {
      const api = createApi(make(asStaff));
      const first = await api.scanner.validate({ cardToken: "mock-ok-a", branchId: BRANCH });
      const second = await api.scanner.validate({ cardToken: "mock-ok-a", branchId: BRANCH });
      expect(first).toMatchObject({
        outcome: "ELIGIBLE",
        customer: { firstName: "Abebe" },
        progress: { current: 2, required: 8 },
      });
      expect(second.progress).toEqual(first.progress);
    });

    it("adds exactly one stamp and answers a retry with the original result", async () => {
      const api = createApi(make(asStaff));
      const key = newIdempotencyKey();
      const first = await api.scanner.stamp({ cardToken: "mock-ok-b", branchId: BRANCH }, key);
      expect(first).toMatchObject({
        outcome: "STAMPED",
        replayed: false,
        progress: { current: 3 },
      });
      const retry = await api.scanner.stamp({ cardToken: "mock-ok-b", branchId: BRANCH }, key);
      expect(retry).toMatchObject({ outcome: "STAMPED", replayed: true, progress: { current: 3 } });
      const next = await api.scanner.stamp(
        { cardToken: "mock-ok-b", branchId: BRANCH },
        newIdempotencyKey(),
      );
      expect(next.progress?.current).toBe(4);
    });

    it("refuses a key reused for a different card", async () => {
      const api = createApi(make(asStaff));
      const key = newIdempotencyKey();
      await api.scanner.stamp({ cardToken: "mock-ok-c", branchId: BRANCH }, key);
      const error = await fail(
        api.scanner.stamp({ cardToken: "mock-ok-d", branchId: BRANCH }, key),
      );
      expect(error).toMatchObject({ kind: "unprocessable", code: "IDEMPOTENCY_KEY_REUSED" });
    });

    it("explains every rejection with safe, bilingual text", async () => {
      const api = createApi(make(asStaff));
      const cases: Array<[string, string | undefined, string]> = [
        ["mock-cooldown", BRANCH, "COOLDOWN_ACTIVE"],
        ["mock-inactive", BRANCH, "MEMBERSHIP_INACTIVE"],
        ["mock-invalid", BRANCH, "INVALID_TOKEN"],
        ["mock-ok-z", "00000000-0000-4000-8000-0000000b9999", "BRANCH_NOT_PERMITTED"],
      ];
      for (const [cardToken, branchId, reason] of cases) {
        const result = await api.scanner.stamp({ cardToken, branchId }, newIdempotencyKey());
        expect(result).toMatchObject({ outcome: "REJECTED", reason });
        expect(result.message.en.length).toBeGreaterThan(3);
        expect(result.message.am.length).toBeGreaterThan(3);
      }
      const cooldown = await api.scanner.validate({ cardToken: "mock-cooldown", branchId: BRANCH });
      expect(cooldown.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("unlocks a reward on the completing stamp, then redeems it exactly once", async () => {
      const api = createApi(make(asStaff));
      const stamped = await api.scanner.stamp(
        { cardToken: "mock-almost", branchId: BRANCH },
        newIdempotencyKey(),
      );
      expect(stamped.reward).toMatchObject({ unlocked: true });
      expect(stamped.progress).toMatchObject({ rewardsAvailable: 1, completedCards: 1 });

      const lookup = await api.scanner.lookupRewards({
        cardToken: "mock-almost",
        branchId: BRANCH,
      });
      expect(lookup.outcome).toBe("AVAILABLE");
      const unlockId = lookup.rewards![0]!.unlockId;

      const key = newIdempotencyKey();
      const redeemed = await api.scanner.redeem(
        { cardToken: "mock-almost", branchId: BRANCH, rewardUnlockId: unlockId },
        key,
      );
      expect(redeemed).toMatchObject({
        outcome: "REDEEMED",
        replayed: false,
        progress: { rewardsAvailable: 0 },
      });
      const replay = await api.scanner.redeem(
        { cardToken: "mock-almost", branchId: BRANCH, rewardUnlockId: unlockId },
        key,
      );
      expect(replay).toMatchObject({ outcome: "REDEEMED", replayed: true });
      const second = await api.scanner.redeem(
        { cardToken: "mock-almost", branchId: BRANCH, rewardUnlockId: unlockId },
        newIdempotencyKey(),
      );
      expect(second).toMatchObject({ outcome: "REJECTED", reason: "NO_REWARD_AVAILABLE" });
    });

    it("says plainly when there is no reward", async () => {
      const lookup = await createApi(make(asStaff)).scanner.lookupRewards({
        cardToken: "mock-ok-q",
        branchId: BRANCH,
      });
      expect(lookup).toMatchObject({ outcome: "REJECTED", reason: "NO_REWARD_AVAILABLE" });
    });
  });

  describe("branches", () => {
    it("lists the branches the signed-in account may use", async () => {
      expect(await createApi(make(asStaff)).branches.list()).toHaveLength(2);
      expect((await fail(createApi(make()).branches.list())).kind).toBe("unauthenticated");
    });
  });
});

describe("live transport specifics", () => {
  it("retries a transient outage on a read and then surfaces it", async () => {
    let calls = 0;
    const { fetch } = createMockFetch();
    const transport = createHttpTransport({
      baseUrl: "https://api.test/api/v1",
      fetch: ((...args: Parameters<typeof fetch>) => (calls++, fetch(...args))) as typeof fetch,
      sleep: async () => undefined,
    });
    const error = await fail(createApi(transport).enrollment.getJoinInfo("down"));
    expect(error.kind).toBe("unavailable");
    expect(calls).toBe(3);
  });

  it("sends a stamp once even when the connection drops", async () => {
    let calls = 0;
    const transport = createHttpTransport({
      baseUrl: "https://api.test/api/v1",
      fetch: (async () => {
        calls++;
        throw new TypeError("connection dropped");
      }) as unknown as typeof fetch,
      sleep: async () => undefined,
      getAccessToken: () => asStaff,
    });
    const error = await fail(
      createApi(transport).scanner.stamp(
        { cardToken: "mock-ok-1", branchId: BRANCH },
        newIdempotencyKey(),
      ),
    );
    expect(error.kind).toBe("network");
    expect(calls).toBe(1);
  });
});
