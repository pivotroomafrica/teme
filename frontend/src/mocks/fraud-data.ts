import type { FraudFlag, FraudThresholds } from "@/lib/api/contract";
import { MOCK_BRANCHES } from "./fixtures";

/**
 * Mock fraud monitoring, following backend/src/modules/fraud and docs/audit-fraud-privacy.md:
 *  - indicators only FLAG; nothing is blocked or penalised;
 *  - a flag is reviewed once (DISMISSED or CONFIRMED) by an owner, with an optional note of at most 500 characters;
 *  - thresholds are defaults merged with the merchant's values; an update is partial and an out-of-range value is
 *    rejected with 400; owners change them, owners and managers read them.
 * Every mock account has its own data.
 */
export type Reply = { status: number; body: unknown };

const err = (status: number, code: string, message: string, details?: unknown): Reply => ({
  status,
  body: {
    error: {
      code,
      message,
      details,
      requestId: "mock-request",
      timestamp: new Date().toISOString(),
    },
  },
});

export const DEFAULTS: FraudThresholds = {
  excessiveStampsPerStaff: { enabled: true, windowMinutes: 60, maxStamps: 40 },
  repeatedScansPerMembership: { enabled: true, windowMinutes: 60, maxAttempts: 6 },
  unusualBranchActivity: {
    enabled: true,
    windowMinutes: 60,
    baselineDays: 7,
    multiplier: 4,
    minStamps: 20,
  },
  highReversalRate: { enabled: true, windowDays: 7, minStamps: 20, maxRatio: 0.2 },
  repeatedCooldownRejections: { enabled: true, windowMinutes: 60, maxRejections: 5 },
  excessiveRedemptions: { enabled: true, windowMinutes: 1440, maxRedemptions: 5 },
};

const LIMITS: Record<string, Record<string, [number, number]>> = {
  excessiveStampsPerStaff: { windowMinutes: [5, 10_080], maxStamps: [1, 100_000] },
  repeatedScansPerMembership: { windowMinutes: [5, 10_080], maxAttempts: [2, 10_000] },
  unusualBranchActivity: {
    windowMinutes: [5, 1440],
    baselineDays: [1, 90],
    multiplier: [1.5, 100],
    minStamps: [1, 100_000],
  },
  highReversalRate: { windowDays: [1, 90], minStamps: [1, 100_000], maxRatio: [0.01, 1] },
  repeatedCooldownRejections: { windowMinutes: [5, 10_080], maxRejections: [2, 10_000] },
  excessiveRedemptions: { windowMinutes: [5, 10_080], maxRedemptions: [1, 10_000] },
};

export interface FraudData {
  flags: FraudFlag[];
  thresholds: FraudThresholds;
  evaluations: number;
}
export type FraudStore = Map<string, FraudData>;

const iso = (ms: number) => new Date(ms).toISOString();
const hex = (n: number) => String(n).padStart(4, "0");

function seed(now: number): FraudData {
  const hour = 3_600_000;
  const kinds: Array<
    [
      FraudFlag["indicator"],
      FraudFlag["subjectType"],
      string,
      number,
      number,
      Record<string, unknown>,
    ]
  > = [
    ["EXCESSIVE_STAMPS_BY_STAFF", "STAFF", "Selam Cashier", 52, 40, { windowMinutes: 60 }],
    ["REPEATED_SCANS_FOR_MEMBERSHIP", "MEMBERSHIP", "Abebe", 9, 6, { accepted: 3, refused: 6 }],
    ["UNUSUAL_BRANCH_ACTIVITY", "BRANCH", MOCK_BRANCHES[1]!.nameEn, 48, 12, { baselineAverage: 3 }],
    ["HIGH_REVERSAL_RATE", "STAFF", "Dawit Manager", 0.31, 0.2, { stamps: 26, reversed: 8 }],
    ["REPEATED_COOLDOWN_REJECTIONS", "MEMBERSHIP", "Tigist", 8, 5, { windowMinutes: 60 }],
    ["EXCESSIVE_REDEMPTIONS", "STAFF", "Selam Cashier", 7, 5, { windowMinutes: 1440 }],
  ];
  const flags = Array.from({ length: 14 }, (_, i): FraudFlag => {
    const [indicator, subjectType, subjectLabel, observed, threshold, details] =
      kinds[i % kinds.length]!;
    const reviewed = i % 5 === 3;
    return {
      id: `00000000-0000-4000-8000-00000f1a${hex(i)}`,
      indicator,
      subjectType,
      subjectId: `00000000-0000-4000-8000-00000f5b${hex(i % kinds.length)}`,
      subjectLabel,
      windowStart: iso(now - (i + 2) * 6 * hour),
      windowEnd: iso(now - (i + 2) * 6 * hour + hour),
      observed,
      threshold,
      details,
      status: reviewed ? (i % 2 ? "CONFIRMED" : "DISMISSED") : "OPEN",
      reviewedAt: reviewed ? iso(now - i * hour) : null,
      reviewNote: reviewed ? "Checked with the branch." : null,
      createdAt: iso(now - (i + 1) * 6 * hour),
    };
  });
  return { flags, thresholds: structuredClone(DEFAULTS), evaluations: 0 };
}

export function fraudFor(store: FraudStore, email: string, now = Date.now()): FraudData {
  let data = store.get(email);
  if (!data) {
    data = seed(now);
    store.set(email, data);
  }
  return data;
}

export function listFlags(data: FraudData, query: Record<string, unknown>): Reply {
  const limit = Math.min(Math.max(Number(query.limit ?? 25) || 25, 1), 100);
  const offset =
    typeof query.cursor === "string" && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 0;
  const str = (k: string) =>
    typeof query[k] === "string" && query[k] ? (query[k] as string) : null;
  if (str("status") && !["OPEN", "DISMISSED", "CONFIRMED"].includes(str("status")!)) {
    return err(400, "VALIDATION_FAILED", "Request validation failed.", [
      "status must be one of OPEN, DISMISSED, CONFIRMED",
    ]);
  }
  const from = str("from") ? Date.parse(str("from")!) : null;
  const to = str("to") ? Date.parse(str("to")!) : null;
  const found = data.flags
    .filter(
      (f) =>
        (!str("status") || f.status === str("status")) &&
        (!str("indicator") || f.indicator === str("indicator")) &&
        (from === null || Date.parse(f.createdAt) >= from) &&
        (to === null || Date.parse(f.createdAt) < to),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const items = found.slice(offset, offset + limit);
  const next = offset + items.length;
  return { status: 200, body: { items, nextCursor: next < found.length ? String(next) : null } };
}

export function reviewFlag(
  data: FraudData,
  flagId: string,
  body: unknown,
  now = Date.now(),
): Reply {
  const flag = data.flags.find((f) => f.id === flagId);
  if (!flag) return err(404, "NOT_FOUND", "Flag not found.");
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const problems: string[] = [];
  if (record.status !== "DISMISSED" && record.status !== "CONFIRMED") {
    problems.push("status must be one of the following values: DISMISSED, CONFIRMED");
  }
  if (record.note !== undefined && (typeof record.note !== "string" || record.note.length > 500)) {
    problems.push("note must be at most 500 characters");
  }
  if (problems.length) return err(400, "VALIDATION_FAILED", "Request validation failed.", problems);
  if (flag.status !== "OPEN")
    return err(409, "ALREADY_REVIEWED", "This flag has already been reviewed.");
  flag.status = record.status as "DISMISSED" | "CONFIRMED";
  flag.reviewedAt = iso(now);
  flag.reviewNote =
    typeof record.note === "string" && record.note.trim() ? record.note.trim() : null;
  return { status: 200, body: flag };
}

export function updateThresholds(data: FraudData, body: unknown): Reply {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return err(400, "VALIDATION_FAILED", "Request validation failed.", ["body must be an object"]);
  }
  const problems: string[] = [];
  const next = structuredClone(data.thresholds);
  for (const [indicator, section] of Object.entries(body as Record<string, unknown>)) {
    const limits = LIMITS[indicator];
    if (!limits || typeof section !== "object" || section === null) {
      problems.push(`${indicator} is not a known indicator`);
      continue;
    }
    for (const [field, value] of Object.entries(section as Record<string, unknown>)) {
      if (field === "enabled") {
        if (typeof value !== "boolean") problems.push(`${indicator}.enabled must be a boolean`);
        else (next[indicator] as Record<string, unknown>).enabled = value;
        continue;
      }
      const range = limits[field];
      if (!range) problems.push(`${indicator}.${field} is not a known setting`);
      else if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < range[0] ||
        value > range[1]
      ) {
        problems.push(`${indicator}.${field} must be between ${range[0]} and ${range[1]}`);
      } else (next[indicator] as Record<string, unknown>)[field] = value;
    }
  }
  if (problems.length) return err(400, "VALIDATION_FAILED", "Request validation failed.", problems);
  data.thresholds = next;
  return { status: 200, body: data.thresholds };
}

/** Running the checks now: raises one more flag when the first indicator is switched on (enough for the screens). */
export function evaluate(data: FraudData, now = Date.now()): Reply {
  data.evaluations += 1;
  let raised = 0;
  if ((data.thresholds.highReversalRate as Record<string, unknown>)?.enabled) {
    data.flags.unshift({
      id: `00000000-0000-4000-8000-00000f1b${hex(data.flags.length + data.evaluations)}`,
      indicator: "HIGH_REVERSAL_RATE",
      subjectType: "STAFF",
      subjectId: "00000000-0000-4000-8000-00000f5b0003",
      subjectLabel: "Dawit Manager",
      windowStart: iso(now - 3_600_000),
      windowEnd: iso(now),
      observed: 0.25,
      threshold: Number((data.thresholds.highReversalRate as Record<string, unknown>).maxRatio),
      details: { stamps: 24, reversed: 6 },
      status: "OPEN",
      reviewedAt: null,
      reviewNote: null,
      createdAt: iso(now),
    });
    raised = 1;
  }
  return { status: 200, body: { evaluated: true, flagsRaised: raised } };
}
