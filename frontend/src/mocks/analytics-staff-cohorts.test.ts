import { describe, expect, it } from "vitest";
import { cohortsFor, resolveMockRange, staffFor, type RangeResult } from "./analytics-data";

const NOW = Date.parse("2026-10-08T09:00:00Z");
const range = (q: Record<string, unknown>) =>
  resolveMockRange(q, NOW) as Extract<RangeResult, { ok: true }>;

describe("staff activity (mock)", () => {
  it("pages with a cursor without repeating or skipping anyone, most stamps first", () => {
    const r = range({ from: "2026-09-09", to: "2026-10-08" });
    const first = staffFor(r, { limit: 10 });
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).toBe("10");
    const second = staffFor(r, { limit: 10, cursor: first.nextCursor });
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items];
    expect(new Set(all.map((s) => s.staffId)).size).toBe(all.length);
    const stamps = all.map((s) => s.stamps);
    expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);
  });

  it("reports the reversal rate as the backend does, and null when there is nothing", () => {
    const busy = staffFor(range({ from: "2026-09-09", to: "2026-10-08" }), { limit: 100 })
      .items[0]!;
    expect(busy.reversalRate).toBeCloseTo(
      busy.stampsReversed / (busy.stamps + busy.stampsReversed),
      3,
    );
    const quiet = staffFor(range({ from: "2025-01-01", to: "2025-01-31" }), { limit: 100 });
    expect(quiet.items.every((s) => s.stamps === 0 && s.reversalRate === null)).toBe(true);
  });
});

describe("retention cohorts (mock)", () => {
  it("lists only months that have happened, with month 0 first", () => {
    const result = cohortsFor({ cohorts: 6 }, NOW);
    if ("error" in result) throw new Error(result.error);
    expect(result.cohorts).toHaveLength(6);
    const last = result.cohorts.at(-1)!;
    expect(last.cohortMonth).toBe("2026-10");
    expect(last.retention.map((r) => r.monthOffset)).toEqual([0]);
    expect(result.cohorts[0]!.retention.length).toBe(6);
    for (const c of result.cohorts) {
      for (const cell of c.retention)
        expect(cell.rate).toBe(Math.round((cell.retained / c.size) * 10_000) / 10_000);
    }
  });

  it("rejects counts outside 1 to 24", () => {
    expect("error" in cohortsFor({ cohorts: 0 }, NOW)).toBe(true);
    expect("error" in cohortsFor({ cohorts: 25 }, NOW)).toBe(true);
  });
});
