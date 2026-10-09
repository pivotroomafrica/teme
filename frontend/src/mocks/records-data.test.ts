import { describe, expect, it } from "vitest";
import {
  auditList,
  listCustomers,
  membershipLedger,
  membershipSummary,
  recordsFor,
  reverse,
  type RecordsStore,
} from "./records-data";

const NOW = Date.parse("2026-10-08T09:00:00.000Z");
const fresh = () => recordsFor(new Map() as RecordsStore, "owner@mock.test", NOW);
const code = (reply: { body: unknown }) =>
  (reply.body as { error?: { code?: string } }).error?.code;

describe("customers", () => {
  it("pages by cursor and never repeats or skips a customer", () => {
    const records = fresh();
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const body = listCustomers(records, { limit: 10, cursor }, true).body as {
        items: Array<{ id: string }>;
        nextCursor: string | null;
      };
      seen.push(...body.items.map((i) => i.id));
      cursor = body.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(records.customers.length);
  });

  it("masks phone numbers unless the caller may manage customers", () => {
    const records = fresh();
    const masked = listCustomers(records, { q: "911000111" }, false).body as {
      items: Array<{ phone: string; phoneMasked: boolean }>;
    };
    expect(masked.items).toHaveLength(1);
    expect(masked.items[0]).toMatchObject({ phone: "+2519*****111", phoneMasked: true });
    const full = listCustomers(records, { q: "911000111" }, true).body as typeof masked;
    expect(full.items[0]).toMatchObject({ phone: "+251911000111", phoneMasked: false });
  });

  it("makes branch staff give a complete number, and lets managers search by name or part of a number", () => {
    const records = fresh();
    const count = (q: string, canManage: boolean) =>
      (listCustomers(records, { q }, canManage).body as { items: unknown[] }).items.length;
    expect(count("Abebe", false)).toBe(0);
    expect(count("9110", false)).toBe(0);
    expect(count("0911000111", false)).toBe(1);
    expect(count("abe", true)).toBe(1);
    expect(count("9110", true)).toBeGreaterThanOrEqual(1);
    expect(count("zzzz", true)).toBe(0);
  });
});

describe("memberships and reversals", () => {
  const abebe = (records: ReturnType<typeof fresh>) => records.customers[0]!;

  it("derives progress and an available reward from the ledger", () => {
    const records = fresh();
    const summary = membershipSummary(records, abebe(records).membershipId).body as {
      effectiveStamps: number;
      progress: { current: number; completedCards: number };
      rewards: Array<{ state: string }>;
    };
    expect(summary.effectiveStamps).toBe(8);
    expect(summary.progress).toMatchObject({ current: 0, completedCards: 1 });
    expect(summary.rewards.map((r) => r.state)).toEqual(["AVAILABLE"]);
  });

  it("requires an idempotency key and a reason of 3 to 500 characters", () => {
    const records = fresh();
    const stamp = abebe(records).entries.find((e) => e.type === "STAMP" && !e.reversed)!;
    expect(
      reverse(records, "owner@mock.test", "STAMP", stamp.id, { reason: "Valid reason" }, undefined)
        .status,
    ).toBe(400);
    expect(
      reverse(records, "owner@mock.test", "STAMP", stamp.id, { reason: "ab" }, "key-aaaaaaaa")
        .status,
    ).toBe(400);
    expect(
      reverse(
        records,
        "owner@mock.test",
        "STAMP",
        stamp.id,
        { reason: "x".repeat(501) },
        "key-bbbbbbbb",
      ).status,
    ).toBe(400);
    expect(reverse(records, "owner@mock.test", "STAMP", stamp.id, {}, "key-cccccccc").status).toBe(
      400,
    );
  });

  it("appends a correction, keeps the original, and re-derives progress", () => {
    const records = fresh();
    const rec = abebe(records);
    const before = rec.entries.length;
    const stamp = rec.entries.find((e) => e.type === "STAMP" && !e.reversed)!;
    const reply = reverse(
      records,
      "manager@mock.test",
      "STAMP",
      stamp.id,
      { reason: "Scanned twice" },
      "key-dddddddd",
      NOW,
    );
    expect(reply.status).toBe(200);
    expect(rec.entries).toHaveLength(before + 1);
    expect(rec.entries.find((e) => e.id === stamp.id)).toMatchObject({ reversed: true });
    const correction = rec.entries[0]!;
    expect(correction).toMatchObject({
      type: "REVERSAL",
      reversal: { targetType: "STAMP", targetId: stamp.id, reason: "Scanned twice" },
    });
    const ledger = membershipLedger(records, rec.membershipId).body as {
      summary: { effectiveStamps: number };
    };
    expect(ledger.summary.effectiveStamps).toBe(7);
  });

  it("answers a repeated key with the same result, and refuses a second reversal", () => {
    const records = fresh();
    const rec = abebe(records);
    const stamp = rec.entries.find((e) => e.type === "STAMP" && !e.reversed)!;
    const first = reverse(
      records,
      "owner@mock.test",
      "STAMP",
      stamp.id,
      { reason: "Mistake" },
      "key-eeeeeeee",
      NOW,
    );
    const again = reverse(
      records,
      "owner@mock.test",
      "STAMP",
      stamp.id,
      { reason: "Mistake" },
      "key-eeeeeeee",
      NOW,
    );
    expect(again.body).toMatchObject({
      replayed: true,
      reversalId: (first.body as { reversalId: string }).reversalId,
    });
    expect(
      rec.entries.filter((e) => e.type === "REVERSAL" && e.reversal?.targetId === stamp.id),
    ).toHaveLength(1);
    const second = reverse(
      records,
      "owner@mock.test",
      "STAMP",
      stamp.id,
      { reason: "Mistake" },
      "key-ffffffff",
      NOW,
    );
    expect(second.status).toBe(409);
    expect(code(second)).toBe("ALREADY_REVERSED");
    const reused = reverse(
      records,
      "owner@mock.test",
      "STAMP",
      "other",
      { reason: "Mistake" },
      "key-eeeeeeee",
      NOW,
    );
    expect(code(reused)).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("refuses to reverse a stamp that a given reward depends on, until the reward is reversed", () => {
    const records = fresh();
    const dawit = records.customers[2]!;
    const stamp = dawit.entries.find((e) => e.type === "STAMP" && !e.reversed)!;
    const redemption = dawit.entries.find((e) => e.type === "REDEMPTION")!;
    expect(
      code(
        reverse(
          records,
          "owner@mock.test",
          "STAMP",
          stamp.id,
          { reason: "Wrong" },
          "key-gggggggg",
          NOW,
        ),
      ),
    ).toBe("REWARD_ALREADY_REDEEMED");
    expect(
      reverse(
        records,
        "owner@mock.test",
        "REDEMPTION",
        redemption.id,
        { reason: "Not given" },
        "key-hhhhhhhh",
        NOW,
      ).status,
    ).toBe(200);
    expect(
      reverse(
        records,
        "owner@mock.test",
        "STAMP",
        stamp.id,
        { reason: "Wrong" },
        "key-iiiiiiii",
        NOW,
      ).status,
    ).toBe(200);
  });

  it("writes an audit entry that does not contain the reason", () => {
    const records = fresh();
    const stamp = abebe(records).entries.find((e) => e.type === "STAMP" && !e.reversed)!;
    reverse(
      records,
      "manager@mock.test",
      "STAMP",
      stamp.id,
      { reason: "A private reason" },
      "key-jjjjjjjj",
      NOW,
    );
    expect(records.audit[0]).toMatchObject({ action: "stamp.reversed" });
    expect(JSON.stringify(records.audit[0])).not.toContain("private reason");
  });
});

describe("audit", () => {
  const items = (
    records: ReturnType<typeof fresh>,
    query: Record<string, unknown>,
    owner = false,
  ) =>
    (
      auditList(records, query, owner).body as {
        items: Array<{ action: string; occurredAt: string; metadata?: Record<string, unknown> }>;
        nextCursor: string | null;
      }
    ).items;

  it("keeps the dashboard's first eight events", () => {
    expect(items(fresh(), { limit: 8 })).toHaveLength(8);
  });

  it("filters by action, prefix, branch, actor and target, and by whole local days", () => {
    const records = fresh();
    expect(
      items(records, { action: "reward.redeemed", limit: 100 }).every(
        (i) => i.action === "reward.redeemed",
      ),
    ).toBe(true);
    expect(
      items(records, { actionPrefix: "stamp.", limit: 100 }).every((i) =>
        i.action.startsWith("stamp."),
      ),
    ).toBe(true);
    const day = items(records, { from: "2026-10-07", to: "2026-10-07", limit: 100 });
    for (const entry of day) {
      const local = new Date(Date.parse(entry.occurredAt) + 3 * 3_600_000)
        .toISOString()
        .slice(0, 10);
      expect(local).toBe("2026-10-07");
    }
    expect(items(records, { actorUserId: "nobody" })).toEqual([]);
  });

  it("rejects a start after the end and pages without gaps", () => {
    const records = fresh();
    expect(auditList(records, { from: "2026-10-09", to: "2026-10-01" }, false).status).toBe(400);
    let cursor: string | undefined;
    let total = 0;
    do {
      const body = auditList(records, { limit: 25, cursor }, false).body as {
        items: unknown[];
        nextCursor: string | null;
      };
      total += body.items.length;
      cursor = body.nextCursor ?? undefined;
    } while (cursor);
    expect(total).toBe(records.audit.length);
  });

  it("only gives network details to owners", () => {
    const records = fresh();
    const withIp = (owner: boolean) =>
      items(records, { limit: 100 }, owner).some((i) => i.metadata && "ip" in i.metadata);
    expect(withIp(true)).toBe(true);
    expect(withIp(false)).toBe(false);
  });
});
