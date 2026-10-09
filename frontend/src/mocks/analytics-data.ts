import type {
  AnalyticsOverview,
  AuditPage,
  BranchActivityPage,
  Cohorts,
  MetricDefinitions,
  MonthlyReturning,
  StaffActivityPage,
  WalletHealth,
} from "@/lib/api/contract";
import { MOCK_BRANCHES } from "./fixtures";

/**
 * Deterministic analytics for the mock backend. The numbers are made up but obey the real definitions' shape:
 * ratios are `null` when their denominator is 0, a bare-date `to` includes that whole day, ranges are at most
 * 366 days, and the current month is flagged `partial`. A range that ends before 2026 has no activity at all,
 * which is how tests reach the empty state.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
const TIME_ZONE = "Africa/Addis_Ababa";

const asDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Today's date in Addis Ababa (UTC+3, no daylight saving). */
export const mockToday = (now = Date.now()) => isoDay(now + 3 * 3_600_000);

export type RangeResult =
  { ok: true; from: string; to: string; days: number } | { ok: false; message: string };

export function resolveMockRange(query: Record<string, unknown>, now = Date.now()): RangeResult {
  const today = mockToday(now);
  const to = typeof query.to === "string" ? query.to : today;
  const from = typeof query.from === "string" ? query.from : isoDay(asDay(to) - 29 * DAY);
  if (!DATE.test(from) || !DATE.test(to))
    return { ok: false, message: "Dates must look like 2026-10-01." };
  const days = Math.round((asDay(to) - asDay(from)) / DAY) + 1;
  if (days < 1) return { ok: false, message: "from must not be after to." };
  if (days > 366) return { ok: false, message: "The range can be at most 366 days." };
  return { ok: true, from, to, days };
}

const describe = (range: Extract<RangeResult, { ok: true }>) => ({
  // [from, to) in UTC, as the backend reports it: Addis midnight is 21:00 UTC the day before.
  from: new Date(asDay(range.from) - 3 * 3_600_000).toISOString(),
  to: new Date(asDay(range.to) + DAY - 3 * 3_600_000).toISOString(),
  timeZone: TIME_ZONE,
  programId: null,
});

const quiet = (range: Extract<RangeResult, { ok: true }>) => range.to < "2026-01-01";
const ratio = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 10_000) / 10_000);

export function overviewFor(range: Extract<RangeResult, { ok: true }>): AnalyticsOverview {
  if (quiet(range)) {
    return {
      range: describe(range),
      newMembers: 0,
      activeMembers: 0,
      returningCustomers: 0,
      stampsIssued: { count: 0, reversed: 0 },
      rewardsUnlocked: 0,
      rewardsRedeemed: 0,
      redemptionRate: null,
      averageVisitsPerActiveMember: null,
      timeBetweenVisits: { intervals: 0, averageHours: null, medianHours: null, p90Hours: null },
    };
  }
  const d = range.days;
  const stamps = d * 12;
  const active = Math.round(d * 5.5);
  const unlocked = Math.round(d * 1.5);
  const redeemed = Math.round(d * 1.2);
  return {
    range: describe(range),
    newMembers: d * 3,
    activeMembers: active,
    returningCustomers: Math.round(active * 0.6),
    stampsIssued: { count: stamps, reversed: Math.floor(d / 10) },
    rewardsUnlocked: unlocked,
    rewardsRedeemed: redeemed,
    redemptionRate: ratio(redeemed, unlocked),
    averageVisitsPerActiveMember: Math.round((stamps / active) * 100) / 100,
    timeBetweenVisits: {
      intervals: stamps - active,
      averageHours: 96.4,
      medianHours: 72,
      p90Hours: 240,
    },
  };
}

export function monthlyReturningFor(
  query: Record<string, unknown>,
  now = Date.now(),
): MonthlyReturning | { error: string } {
  const current = mockToday(now).slice(0, 7);
  const month = typeof query.month === "string" ? query.month : current;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: "month must look like 2026-10." };
  if (month > current) return { error: "month cannot be in the future." };
  const months = query.months === undefined ? 6 : Number(query.months);
  if (!Number.isInteger(months) || months < 1 || months > 24) {
    return { error: "months must be between 1 and 24." };
  }
  const shift = (m: string, by: number) => {
    const index = +m.slice(0, 4) * 12 + (+m.slice(5, 7) - 1) + by;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  };
  const series = Array.from({ length: months }, (_, i) => {
    const m = shift(month, i - (months - 1));
    const active = 80 + ((+m.slice(5, 7) * 17) % 40);
    const returning = Math.round(active * 0.55);
    return {
      month: m,
      returningCustomers: returning,
      activeMembers: active,
      returningShare: ratio(returning, active),
      partial: m === current,
    };
  });
  return {
    metric: "monthlyReturningLoyaltyCustomers",
    timeZone: TIME_ZONE,
    month,
    value: series[series.length - 1]!.returningCustomers,
    series,
  };
}

export function branchesFor(range: Extract<RangeResult, { ok: true }>): BranchActivityPage {
  const empty = quiet(range);
  const items = MOCK_BRANCHES.map((b, i) => ({
    branchId: b.id,
    nameEn: b.nameEn,
    nameAm: b.nameAm,
    stamps: empty ? 0 : range.days * (8 - i * 3),
    uniqueCustomers: empty ? 0 : range.days * (4 - i),
    redemptions: empty ? 0 : range.days * (1 + (i === 0 ? 1 : 0)),
  }));
  return { range: describe(range), items, nextCursor: null };
}

const STAFF_NAMES = [
  "Selam Cashier",
  "Dawit Manager",
  "Hana Owner",
  "Yonas Barista",
  "Meron Server",
  "Kebede Host",
  "Liya Cashier",
  "Eyob Runner",
  "Saba Barista",
  "Girma Cashier",
  "Aster Server",
  "Nahom Host",
];

/** Staff stamping activity, most stamps first, keyset-paged by position like the backend's opaque cursor. */
export function staffFor(
  range: Extract<RangeResult, { ok: true }>,
  query: Record<string, unknown> = {},
): StaffActivityPage {
  const empty = quiet(range);
  const limit = Math.min(Math.max(Number(query.limit ?? 25) || 25, 1), 100);
  const offset =
    typeof query.cursor === "string" && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 0;
  const all = STAFF_NAMES.map((displayName, i) => {
    const stamps = empty ? 0 : Math.max(1, range.days * (12 - i));
    const reversed = empty ? 0 : i % 4 === 0 ? Math.ceil(stamps / 10) : 0;
    return {
      staffId: `00000000-0000-4000-8000-0000000c${String(100 + i).padStart(4, "0")}`,
      displayName,
      role: i === 1 ? "MANAGER" : i === 2 ? "OWNER" : "STAFF",
      status: i === 11 ? "DEACTIVATED" : "ACTIVE",
      stamps,
      stampsReversed: reversed,
      reversalRate: ratio(reversed, stamps + reversed),
      uniqueCustomers: empty ? 0 : Math.max(1, Math.round(stamps * 0.6)),
      redemptions: empty ? 0 : Math.max(0, 6 - Math.floor(i / 2)),
    };
  });
  const items = all.slice(offset, offset + limit);
  const next = offset + items.length;
  return { range: describe(range), items, nextCursor: next < all.length ? String(next) : null };
}

/** Retention cohorts by local join month. Months that have not happened yet are not listed. */
export function cohortsFor(
  query: Record<string, unknown>,
  now = Date.now(),
): Cohorts | { error: string } {
  const count = query.cohorts === undefined ? 6 : Number(query.cohorts);
  if (!Number.isInteger(count) || count < 1 || count > 24) {
    return { error: "cohorts must be between 1 and 24." };
  }
  const current = mockToday(now).slice(0, 7);
  const index = (m: string) => +m.slice(0, 4) * 12 + (+m.slice(5, 7) - 1);
  const label = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  const cohorts = Array.from({ length: count }, (_, n) => {
    const month = label(index(current) - (count - 1) + n);
    const elapsed = Math.min(index(current) - index(month), 12);
    const size = 40 + ((n * 13) % 30);
    return {
      cohortMonth: month,
      size,
      retention: Array.from({ length: elapsed + 1 }, (_, k) => {
        const retained =
          k === 0 ? Math.round(size * 0.9) : Math.max(1, Math.round(size * 0.6 * 0.85 ** k));
        return { monthOffset: k, retained, rate: ratio(retained, size) };
      }),
    };
  });
  return { timeZone: TIME_ZONE, programId: null, cohorts };
}

export function walletFor(range: Extract<RangeResult, { ok: true }>): WalletHealth {
  const empty = quiet(range);
  const failed = empty ? 0 : 2;
  const succeeded = empty ? 0 : range.days * 6;
  return {
    range: describe(range),
    activeMemberships: empty ? 0 : 420,
    providers: [
      { provider: "APPLE", memberships: empty ? 0 : 84, adoptionRate: empty ? null : 0.2 },
      { provider: "GOOGLE", memberships: empty ? 0 : 126, adoptionRate: empty ? null : 0.3 },
      { provider: "WEB", memberships: empty ? 0 : 420, adoptionRate: empty ? null : 1 },
    ],
    passSync: empty
      ? []
      : [
          { status: "SYNCED", passes: 205 },
          { status: "PENDING", passes: 5 },
        ],
    updates: {
      succeeded,
      failed,
      stillQueued: empty ? 0 : 3,
      succeededAfterRetry: empty ? 0 : 4,
      successRate: ratio(succeeded, succeeded + failed),
    },
  };
}

export const MOCK_DEFINITIONS: MetricDefinitions = [
  {
    key: "newMembers",
    name: "New members",
    definition: "Memberships whose join time falls in the range.",
  },
  {
    key: "activeMembers",
    name: "Active members",
    definition: "Unique customers with at least one qualifying visit in the range.",
  },
  {
    key: "monthlyReturningLoyaltyCustomers",
    name: "Monthly Returning Loyalty Customers (north-star)",
    definition:
      "Unique customers with a qualifying visit in the selected local month who also had one before that month began.",
  },
  {
    key: "stampsIssued",
    name: "Stamps issued",
    definition:
      "Qualifying visits in the range. Reversed counts stamps given in the range that were later reversed.",
  },
  {
    key: "rewardsUnlocked",
    name: "Rewards unlocked",
    definition:
      "Rewards earned in the range, not counting those whose triggering stamp was reversed.",
  },
  {
    key: "rewardsRedeemed",
    name: "Rewards redeemed",
    definition: "Redemptions made in the range that were not reversed.",
  },
  {
    key: "redemptionRate",
    name: "Redemption rate",
    definition:
      "Rewards redeemed divided by rewards unlocked in the range. Can exceed 1. Null when nothing was unlocked.",
  },
];

const EVENTS: Array<[string, string | null, string | null, number]> = [
  ["stamp.issued", "Selam Cashier", MOCK_BRANCHES[0]!.id, 4],
  ["reward.unlocked", null, MOCK_BRANCHES[0]!.id, 4],
  ["scan.rejected", "Selam Cashier", MOCK_BRANCHES[1]!.id, 35],
  ["staff.role_changed", "Hana Owner", null, 180],
  ["program.activated", "Hana Owner", null, 1_500],
  ["auth.login", "Dawit Manager", null, 2_000],
  ["branch.updated", "Hana Owner", MOCK_BRANCHES[1]!.id, 3_100],
  ["some.future_action", null, null, 5_000],
];

export function auditFor(limit: number, now = Date.now()): AuditPage {
  return {
    items: EVENTS.slice(0, limit).map(([action, name, branchId, minutesAgo], i) => ({
      id: `00000000-0000-4000-8000-00000000f${String(i).padStart(3, "0")}`,
      occurredAt: new Date(now - minutesAgo * 60_000).toISOString(),
      action,
      actor: name
        ? { type: "USER" as const, userId: `user-${i}`, displayName: name }
        : { type: "SYSTEM" as const, userId: null, displayName: null },
      branchId,
      targetType: null,
      targetId: null,
    })),
    nextCursor: null,
  };
}
