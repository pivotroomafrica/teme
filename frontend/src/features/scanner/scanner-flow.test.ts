import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/errors/api-error";
import type { RedeemResult, ScanResult } from "@/lib/api/contract";
import {
  RECENT_LIMIT,
  canStamp,
  classifyFailure,
  cooldownMinutes,
  initialScannerState,
  isStampOnlyBlock,
  rejectionView,
  scannerReducer,
  type ScannerAction,
  type ScannerState,
} from "./scanner-flow";

const MESSAGE = { en: "Message", am: "መልዕክት" };
const progress = { current: 3, required: 8, remaining: 5, completedCards: 0, rewardsAvailable: 0 };

const eligible: ScanResult = {
  outcome: "ELIGIBLE",
  reason: null,
  message: MESSAGE,
  customer: { firstName: "Abebe" },
  progress,
  replayed: false,
};
const cooldown: ScanResult = {
  outcome: "REJECTED",
  reason: "COOLDOWN_ACTIVE",
  message: MESSAGE,
  retryAfterSeconds: 120,
  customer: { firstName: "Abebe" },
  progress,
  replayed: false,
};
const invalid: ScanResult = {
  outcome: "REJECTED",
  reason: "INVALID_TOKEN",
  message: MESSAGE,
  replayed: false,
};
const stamped: ScanResult = {
  ...eligible,
  outcome: "STAMPED",
  stamp: { id: "s1", occurredAt: "x" },
};
const rewardsAvailable: RedeemResult = {
  outcome: "AVAILABLE",
  reason: null,
  message: MESSAGE,
  rewards: [
    {
      unlockId: "u1",
      nameEn: "Free coffee",
      nameAm: null,
      descriptionEn: null,
      descriptionAm: null,
      unlockedAt: "x",
      expiresAt: null,
    },
  ],
  replayed: false,
};
const noReward: RedeemResult = {
  outcome: "REJECTED",
  reason: "NO_REWARD_AVAILABLE",
  message: MESSAGE,
  replayed: false,
};

function run(actions: ScannerAction[], from: ScannerState = initialScannerState) {
  return actions.reduce(scannerReducer, from);
}

const reading: ScannerAction[] = [{ type: "codeRead", token: "token-12345" }];
const checked = (check: ScanResult, rewards: RedeemResult | null): ScannerAction => ({
  type: "checked",
  token: "token-12345",
  check,
  rewards,
  now: 1,
});

describe("scanner flow", () => {
  it("goes from a read code, through the backend check, to a confirmation", () => {
    const state = run([...reading, checked(eligible, noReward)]);
    expect(state.phase).toMatchObject({ name: "confirm", token: "token-12345", rewards: null });
  });

  it("ignores a second code while one is being handled", () => {
    const state = run([...reading, { type: "codeRead", token: "another-token-1" }]);
    expect(state.phase).toEqual({ name: "checking", token: "token-12345" });
  });

  it("ignores an answer for a card that is no longer the current one", () => {
    const state = run([
      ...reading,
      { type: "checked", token: "other-token-99", check: eligible, rewards: null, now: 1 },
    ]);
    expect(state.phase.name).toBe("checking");
  });

  it("shows a rejection straight away when the card cannot be used at all", () => {
    const state = run([...reading, checked(invalid, null)]);
    expect(state.phase).toMatchObject({
      name: "done",
      outcome: { kind: "rejected", reason: "INVALID_TOKEN" },
    });
    expect(state.recent[0]).toMatchObject({ kind: "rejected" });
  });

  it("keeps a reward reachable when only stamping is blocked", () => {
    const state = run([...reading, checked(cooldown, rewardsAvailable)]);
    expect(state.phase).toMatchObject({ name: "confirm" });
    expect(isStampOnlyBlock(cooldown)).toBe(true);
    expect(canStamp(cooldown)).toBe(false);
  });

  it("does not offer a reward the backend said is unavailable", () => {
    const state = run([...reading, checked(eligible, noReward)]);
    expect(state.phase).toMatchObject({ name: "confirm", rewards: null });
  });

  it("records a confirmed stamp once, with a first name and no card code", () => {
    const state = run([
      ...reading,
      checked(eligible, null),
      { type: "stampStarted", token: "token-12345", key: "key-12345678", name: "Abebe" },
      { type: "stamped", result: stamped, name: "Abebe", now: 5 },
    ]);
    expect(state.phase).toMatchObject({ name: "done", outcome: { kind: "stamped" } });
    expect(state.recent).toEqual([{ id: 1, kind: "stamp", name: "Abebe", at: 5 }]);
    expect(JSON.stringify(state.recent)).not.toContain("token-12345");
  });

  it("shows a rejection if the backend refuses the stamp itself", () => {
    const state = run([
      ...reading,
      checked(eligible, null),
      { type: "stampStarted", token: "token-12345", key: "key-12345678", name: "Abebe" },
      { type: "rejected", result: cooldown, name: "Abebe", now: 5 },
    ]);
    expect(state.phase).toMatchObject({
      name: "done",
      outcome: { kind: "rejected", reason: "COOLDOWN_ACTIVE", retryAfterSeconds: 120 },
    });
  });

  it("separates redeeming from stamping and records it", () => {
    const state = run([
      ...reading,
      checked(eligible, rewardsAvailable),
      {
        type: "redeemStarted",
        token: "token-12345",
        key: "key-87654321",
        name: "Abebe",
        unlockId: "u1",
      },
      {
        type: "redeemed",
        result: { outcome: "REDEEMED", reason: null, message: MESSAGE, replayed: false },
        name: "Abebe",
        now: 9,
      },
    ]);
    expect(state.phase).toMatchObject({ name: "done", outcome: { kind: "redeemed" } });
    expect(state.recent[0]).toMatchObject({ kind: "redeem" });
  });

  it("cannot reach a success screen without a started action", () => {
    const state = run([...reading, { type: "stamped", result: stamped, name: "Abebe", now: 1 }]);
    expect(state.phase.name).toBe("checking");
  });

  it("keeps the same idempotency key when a lost answer is checked again", () => {
    const pending = {
      action: "stamp",
      token: "token-12345",
      key: "key-12345678",
      name: "Abebe",
    } as const;
    const state = run([
      ...reading,
      checked(eligible, null),
      { type: "stampStarted", token: "token-12345", key: "key-12345678", name: "Abebe" },
      { type: "failed", pending, kind: "unavailable", uncertain: true },
      { type: "stampStarted", token: "token-12345", key: "key-12345678", name: "Abebe" },
    ]);
    expect(state.phase).toMatchObject({ name: "stamping", key: "key-12345678" });
  });

  it("returns to ready on dismiss from any screen", () => {
    const state = run([...reading, checked(invalid, null), { type: "dismiss" }]);
    expect(state.phase).toEqual({ name: "ready" });
  });

  it("treats text that is not a card as a rejection without a backend call", () => {
    expect(run([{ type: "notACard" }]).phase).toMatchObject({
      name: "done",
      outcome: { kind: "notCard" },
    });
  });

  it("keeps only the most recent entries", () => {
    let state = initialScannerState;
    for (let n = 0; n < RECENT_LIMIT + 3; n++) {
      state = run(
        [
          ...reading,
          checked(eligible, null),
          { type: "stampStarted", token: "token-12345", key: "key-12345678", name: `P${n}` },
          { type: "stamped", result: stamped, name: `P${n}`, now: n },
          { type: "dismiss" },
        ],
        state,
      );
    }
    expect(state.recent).toHaveLength(RECENT_LIMIT);
    expect(state.recent[0]!.name).toBe(`P${RECENT_LIMIT + 2}`);
  });
});

describe("classifyFailure", () => {
  const api = (kind: ConstructorParameters<typeof ApiError>[0]["kind"], extra = {}) =>
    new ApiError({ kind, code: "X", message: "x", ...extra });

  it("treats a refusal as certain: nothing was recorded", () => {
    expect(classifyFailure(api("forbidden"), true)).toEqual({
      kind: "permission",
      uncertain: false,
    });
    expect(classifyFailure(api("rate_limited", { retryAfterSeconds: 9 }), true)).toEqual({
      kind: "rate",
      uncertain: false,
      retryAfterSeconds: 9,
    });
  });

  it("treats a lost connection or server trouble as unknown, never as failed", () => {
    expect(classifyFailure(api("network"), true)).toEqual({ kind: "unavailable", uncertain: true });
    expect(classifyFailure(api("network"), false)).toEqual({ kind: "offline", uncertain: true });
    for (const kind of ["timeout", "unavailable", "server"] as const) {
      expect(classifyFailure(api(kind), true)).toEqual({ kind: "unavailable", uncertain: true });
    }
  });

  it("treats anything unrecognised as unknown", () => {
    expect(classifyFailure(new Error("boom"), true)).toEqual({
      kind: "unexpected",
      uncertain: true,
    });
  });
});

describe("rejectionView and cooldownMinutes", () => {
  it("has a headline for every reason, warnings only for things that pass or need another action", () => {
    expect(rejectionView("INVALID_TOKEN")).toMatchObject({
      title: "scanner.invalidTitle",
      tone: "danger",
    });
    expect(rejectionView("COOLDOWN_ACTIVE")).toMatchObject({ tone: "warning" });
    expect(rejectionView("MEMBERSHIP_INACTIVE")).toMatchObject({ tone: "danger" });
    expect(rejectionView("BRANCH_NOT_PERMITTED").title).toBe("scanner.branchTitle");
    expect(rejectionView(null).title).toBe("scanner.rejectedTitle");
  });

  it("rounds a wait up to whole minutes, never understating it", () => {
    expect(cooldownMinutes(1)).toBe(1);
    expect(cooldownMinutes(60)).toBe(1);
    expect(cooldownMinutes(61)).toBe(2);
    expect(cooldownMinutes(120)).toBe(2);
    expect(cooldownMinutes(undefined)).toBe(1);
  });
});
