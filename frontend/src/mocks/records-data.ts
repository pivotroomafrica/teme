import type {
  AuditPage,
  Customer,
  LedgerEntry,
  MembershipSummary,
  WalletPass,
} from "@/lib/api/contract";
import { auditFor } from "./analytics-data";
import { MOCK_ACCOUNTS, MOCK_BRANCHES, type MockEmail } from "./fixtures";

/**
 * Mock customers, their ledgers and the audit history. Rules follow the backend (see
 * backend/docs/rewards-and-reversals.md and customers/audit services):
 *  - the ledger is append-only: a reversal ADDS an entry that points at the original and sets the original's derived
 *    `reversed` flag; nothing is removed or edited, and progress and rewards are re-derived from the whole ledger;
 *  - a reason of 3 to 500 characters and an idempotency key are mandatory; a second reversal of the same event is
 *    409 ALREADY_REVERSED; reversing a stamp that would leave a redeemed reward without stamps behind it is
 *    409 REWARD_ALREADY_REDEEMED (reverse the redemption first);
 *  - phone numbers are masked ("+2519*****567") unless the caller may manage customers, and branch staff must
 *    search with a complete number;
 *  - audit entries never contain the reason of a reversal; owners also receive network details in the metadata
 *    (which clients must not show), managers do not.
 * Every mock account has its own data, so tests running side by side never change each other's.
 */
export type Reply = { status: number; body: unknown };

const REQUIRED = 8;
const iso = (ms: number) => new Date(ms).toISOString();
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

export interface CustomerRec {
  customer: Omit<Customer, "phone" | "phoneMasked">;
  phone: string;
  membershipId: string;
  entries: LedgerEntry[];
  /** Reward rows ever created for this card (a row is appended when a card is completed). */
  unlocks: number;
  passes: WalletPass[];
}

export interface AuditRec {
  id: string;
  occurredAt: string;
  action: string;
  actor: { type: "USER" | "SYSTEM"; userId: string | null; displayName: string | null };
  branchId: string | null;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
}

export interface Records {
  customers: CustomerRec[];
  audit: AuditRec[];
  idempotency: Map<string, { fingerprint: string; reply: Reply }>;
  /** Months of inactivity after which customers are anonymised automatically (0 = off). */
  retentionMonths: number;
}
export type RecordsStore = Map<string, Records>;

const NAMES = [
  "Abebe",
  "Tigist",
  "Dawit",
  "Selam",
  "Hana",
  "Kebede",
  "Meron",
  "Yonas",
  "Rahel",
  "Samuel",
  "Bethlehem",
  "Henok",
  "Liya",
  "Eyob",
  "Mulu",
  "Girma",
  "Saba",
  "Tadesse",
  "Aster",
  "Nahom",
  "Zewditu",
  "Biruk",
  "Almaz",
  "Fikru",
];
const ACCOUNT_ID = (email: MockEmail) => MOCK_ACCOUNTS[email].id;
const STAFF_ID = ACCOUNT_ID("staff@mock.test");
const MANAGER_ID = ACCOUNT_ID("manager@mock.test");
const OWNER_ID = ACCOUNT_ID("owner@mock.test");
const BOLE = MOCK_BRANCHES[0]!.id;
const PIASSA = MOCK_BRANCHES[1]!.id;

function seedCustomers(now: number): CustomerRec[] {
  const day = 86_400_000;
  let n = 0;
  const id = (kind: string) =>
    `00000000-0000-4000-8000-${kind}${String(++n).padStart(8, "0")}`.slice(0, 36);
  const stamp = (ageDays: number, reversed = false, branch = BOLE): LedgerEntry => ({
    type: "STAMP",
    id: id("a1"),
    occurredAt: iso(now - ageDays * day),
    branchId: branch,
    staffMembershipId: STAFF_ID,
    reversed,
  });

  return NAMES.map((name, index) => {
    const phone = `+2519${String(11_000_111 + index * 1_111_111).slice(0, 8)}`;
    // The first two keep the numbers the scanner's phone lookup has always found.
    const fixedPhone = index === 0 ? "+251911000111" : index === 1 ? "+251922000222" : phone;
    const membershipId = `00000000-0000-4000-8000-0000000f${String(index).padStart(4, "0")}`;
    let entries: LedgerEntry[];
    let unlocks = 0;
    if (index === 0) {
      // Abebe: 8 effective stamps (a reward is waiting), plus one stamp that was reversed earlier.
      const reversedStamp = stamp(40, true);
      entries = [
        ...Array.from({ length: 8 }, (_, i) => stamp(30 - i * 3, false, i % 2 ? PIASSA : BOLE)),
        reversedStamp,
        {
          type: "REVERSAL",
          id: id("b1"),
          occurredAt: iso(now - 39 * day),
          staffMembershipId: MANAGER_ID,
          reversal: {
            targetType: "STAMP",
            targetId: reversedStamp.id,
            reason: "Scanned twice by mistake.",
          },
        },
      ];
      unlocks = 1;
    } else if (index === 2) {
      // Dawit: exactly 8 stamps and the reward already redeemed (so reversing a stamp must be refused).
      const stamps = Array.from({ length: 8 }, (_, i) => stamp(25 - i * 2));
      entries = [
        ...stamps,
        {
          type: "REDEMPTION",
          id: id("c1"),
          occurredAt: iso(now - 5 * day),
          branchId: BOLE,
          staffMembershipId: STAFF_ID,
          reversed: false,
          rewardUnlockId: "unlock-1",
        },
      ];
      unlocks = 1;
    } else {
      entries = Array.from({ length: 2 + (index % 5) }, (_, i) => stamp(20 - i * 3 - (index % 4)));
    }
    entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return {
      customer: {
        id: `00000000-0000-4000-8000-0000000e${String(index + 1).padStart(4, "0")}`,
        firstName: name,
        preferredLanguage: index % 3 === 2 ? "AM" : "EN",
        joinedAt: iso(now - (3 + index * 2) * day),
        marketingConsent: index % 2 === 0,
        memberships: [
          {
            id: membershipId,
            programId: "00000000-0000-4000-8000-0000000d0001",
            status: index === 1 ? "INACTIVE" : "ACTIVE",
            joinedAt: iso(now - (3 + index * 2) * day),
          },
        ],
      },
      phone: fixedPhone,
      membershipId,
      entries,
      unlocks,
      passes: [
        {
          id: `pass-${index}-web`,
          provider: "WEB",
          status: "ACTIVE",
          syncStatus: "SYNCED",
          passVersion: 3,
          lastSyncedVersion: 3,
          lastSyncedAt: iso(now - day),
        },
        ...(index % 2 === 0
          ? [
              {
                id: `pass-${index}-g`,
                provider: "GOOGLE" as const,
                status: "ACTIVE" as const,
                syncStatus: (index === 4 ? "FAILED" : "SYNCED") as WalletPass["syncStatus"],
                passVersion: 3,
                lastSyncedVersion: index === 4 ? 2 : 3,
                lastSyncedAt: iso(now - 2 * day),
              },
            ]
          : []),
      ],
    };
  });
}

const ACTORS: Record<string, AuditRec["actor"]> = {
  selam: { type: "USER", userId: STAFF_ID, displayName: "Selam Cashier" },
  dawit: { type: "USER", userId: MANAGER_ID, displayName: "Dawit Manager" },
  hana: { type: "USER", userId: OWNER_ID, displayName: "Hana Owner" },
  system: { type: "SYSTEM", userId: null, displayName: null },
};

function seedAudit(now: number): AuditRec[] {
  // The first eight are the ones the dashboard has always shown; keep them as they were.
  const head: AuditRec[] = auditFor(8, now).items.map((item) => {
    const actor =
      item.actor.displayName === "Selam Cashier"
        ? ACTORS.selam!
        : item.actor.displayName === "Dawit Manager"
          ? ACTORS.dawit!
          : item.actor.displayName === "Hana Owner"
            ? ACTORS.hana!
            : ACTORS.system!;
    return { ...item, actor, requestId: `req-${item.id.slice(-4)}`, metadata: {} };
  });
  head[5]!.metadata = {
    method: "password",
    // Defence in depth: the backend never sends these, and the screen must not show them if it ever did.
    token: "BAIT-TOKEN-VALUE",
    password: "BAIT-PASSWORD",
    walletCredential: "BAIT-WALLET-CREDENTIAL",
    ip: "10.0.0.7",
    userAgent: "BaitBrowser/1.0",
  };
  head[3]!.metadata = { from: "MANAGER", to: "STAFF" };
  head[0]!.metadata = { membershipId: "m-1", cardCount: 3, firstVisit: false };

  const cycle: Array<
    [string, keyof typeof ACTORS, string | null, string | null, Record<string, unknown>]
  > = [
    ["stamp.issued", "selam", BOLE, "membership", { membershipId: "m-2" }],
    [
      "reward.redeemed",
      "selam",
      BOLE,
      "membership",
      { membershipId: "m-3", rewardUnlockId: "u-3" },
    ],
    ["scan.rejected", "selam", PIASSA, null, { reason: "COOLDOWN_ACTIVE" }],
    [
      "redemption.reversed",
      "dawit",
      null,
      "membership",
      { membershipId: "m-4", reversedEventId: "r-4" },
    ],
    ["stamp.reversed", "hana", null, "membership", { membershipId: "m-5", reversedEventId: "s-5" }],
    [
      "reward.redeemed",
      "selam",
      PIASSA,
      "membership",
      { membershipId: "m-6", rewardUnlockId: "u-6" },
    ],
    ["staff.invited", "hana", null, "staff_membership", { role: "STAFF" }],
    ["branch.updated", "hana", PIASSA, "branch", { changedFields: ["city", "phone"] }],
    ["program.updated", "dawit", null, "program", { changedFields: ["cooldownMinutes"] }],
    ["customer.enrolled", "system", BOLE, "customer", { language: "AM" }],
    ["membership.card_reissued", "dawit", null, "membership", { membershipId: "m-7" }],
    ["auth.login", "selam", null, null, { method: "password" }],
  ];
  const generated: AuditRec[] = Array.from({ length: 70 }, (_, i) => {
    const [action, who, branchId, targetType, metadata] = cycle[i % cycle.length]!;
    return {
      id: `00000000-0000-4000-8000-00000000a${String(i).padStart(3, "0")}`,
      occurredAt: iso(now - (6_000 + i * 410) * 60_000),
      action,
      actor: ACTORS[who]!,
      branchId,
      targetType,
      targetId: targetType
        ? `00000000-0000-4000-8000-0000000t${String(i).padStart(4, "0")}`.replace("t", "9")
        : null,
      requestId: `req-g${i}`,
      metadata: { ...metadata },
    };
  });
  return [...head, ...generated];
}

export function recordsFor(store: RecordsStore, email: string, now = Date.now()): Records {
  let records = store.get(email);
  if (!records) {
    records = {
      customers: seedCustomers(now),
      audit: seedAudit(now),
      idempotency: new Map(),
      retentionMonths: 36,
    };
    store.set(email, records);
  }
  return records;
}

// ───────── customers ─────────

const maskPhone = (phone: string) =>
  phone.length <= 8
    ? "*".repeat(phone.length)
    : `${phone.slice(0, 5)}${"*".repeat(phone.length - 8)}${phone.slice(-3)}`;

/** The backend's search rules: a complete number, 4+ digits (managers only), or part of a first name. */
function matches(rec: CustomerRec, q: string, canManage: boolean): boolean {
  const text = q.replace(/[%_\\]/g, "").trim();
  if (!text) return true;
  if (/^[+\d\s\-().]+$/.test(text)) {
    const digits = text.replace(/\D/g, "");
    const national = digits.replace(/^(?:00)?251/, "").replace(/^0/, "");
    if (national.length === 9) return rec.phone.endsWith(national);
    return canManage && digits.length >= 4 && rec.phone.replace(/\D/g, "").includes(digits);
  }
  return (
    canManage &&
    text.length >= 2 &&
    (rec.customer.firstName ?? "").toLowerCase().includes(text.toLowerCase())
  );
}

export function listCustomers(
  records: Records,
  query: Record<string, unknown>,
  canManage: boolean,
): Reply {
  const limit = Math.min(Math.max(Number(query.limit ?? 10) || 10, 1), 100);
  const offset =
    typeof query.cursor === "string" && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 0;
  const found = records.customers
    .filter((rec) => matches(rec, typeof query.q === "string" ? query.q : "", canManage))
    .sort((a, b) => b.customer.joinedAt.localeCompare(a.customer.joinedAt));
  const items = found.slice(offset, offset + limit).map((rec) => ({
    ...rec.customer,
    // An anonymised customer has no name or number left to show.
    phone: !rec.phone ? null : canManage ? rec.phone : maskPhone(rec.phone),
    phoneMasked: !canManage,
  }));
  const next = offset + items.length;
  return { status: 200, body: { items, nextCursor: next < found.length ? String(next) : null } };
}

// ───────── memberships ─────────

export const find = (records: Records, membershipId: string) =>
  records.customers.find((c) => c.membershipId === membershipId);

export function derive(rec: CustomerRec): MembershipSummary {
  const effective = rec.entries.filter((e) => e.type === "STAMP" && !e.reversed).length;
  const redemptions = rec.entries.filter((e) => e.type === "REDEMPTION");
  const redeemedActive = redemptions.filter((r) => !r.reversed);
  const earned = Math.floor(effective / REQUIRED);
  const rewards = Array.from(
    { length: rec.unlocks },
    (_, i): MembershipSummary["rewards"][number] => {
      const redemption = redeemedActive[i];
      const state = redemption ? "REDEEMED" : i < earned ? "AVAILABLE" : "REVERSED";
      return {
        id: `unlock-${i + 1}`,
        state,
        unlockedAt: iso(Date.now() - (30 - i) * 86_400_000),
        expiresAt: null,
        nameEn: "Free coffee",
        nameAm: "ነጻ ቡና",
        descriptionEn: "Any coffee from the menu.",
        descriptionAm: "ከዝርዝሩ ማንኛውም ቡና።",
        redemptionAttempts: redemptions.length,
        redemption: redemption ? { id: redemption.id, occurredAt: redemption.occurredAt } : null,
      };
    },
  );
  return {
    membershipId: rec.membershipId,
    status: rec.customer.memberships[0]!.status,
    effectiveStamps: effective,
    progress: {
      current: effective % REQUIRED,
      required: REQUIRED,
      remaining: REQUIRED - (effective % REQUIRED),
      completedCards: earned,
    },
    rewards,
  };
}

export function membershipSummary(records: Records, membershipId: string): Reply {
  const rec = find(records, membershipId);
  return rec ? { status: 200, body: derive(rec) } : err(404, "NOT_FOUND", "Membership not found.");
}

export function membershipLedger(records: Records, membershipId: string): Reply {
  const rec = find(records, membershipId);
  if (!rec) return err(404, "NOT_FOUND", "Membership not found.");
  return { status: 200, body: { summary: derive(rec), entries: rec.entries } };
}

export function membershipPasses(records: Records, membershipId: string): Reply {
  const rec = find(records, membershipId);
  return rec ? { status: 200, body: rec.passes } : err(404, "NOT_FOUND", "Membership not found.");
}

// ───────── reversals ─────────

export function reverse(
  records: Records,
  email: MockEmail,
  kind: "STAMP" | "REDEMPTION",
  targetId: string,
  body: unknown,
  idempotencyKey: string | undefined,
  now = Date.now(),
): Reply {
  if (!idempotencyKey) {
    return err(400, "VALIDATION_FAILED", "Request validation failed.", [
      "Idempotency-Key header is required",
    ]);
  }
  const reason =
    typeof body === "object" && body !== null ? (body as { reason?: unknown }).reason : undefined;
  const cleaned =
    typeof reason === "string" ? reason.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  if (typeof reason !== "string" || cleaned.length < 3 || cleaned.length > 500) {
    return err(400, "VALIDATION_FAILED", "Request validation failed.", [
      "reason must be between 3 and 500 characters",
    ]);
  }
  const fingerprint = `${kind}|${targetId}`;
  const remembered = records.idempotency.get(idempotencyKey);
  if (remembered) {
    return remembered.fingerprint === fingerprint
      ? { status: 200, body: { ...(remembered.reply.body as object), replayed: true } }
      : err(422, "IDEMPOTENCY_KEY_REUSED", "This key was already used for a different request.");
  }

  const rec = records.customers.find((c) =>
    c.entries.some((e) => e.id === targetId && e.type === kind),
  );
  const original = rec?.entries.find((e) => e.id === targetId && e.type === kind);
  if (!rec || !original)
    return err(404, "NOT_FOUND", `${kind === "STAMP" ? "Stamp" : "Redemption"} not found.`);
  if (original.reversed)
    return err(409, "ALREADY_REVERSED", "This event has already been reversed.");

  if (kind === "STAMP") {
    const effective = rec.entries.filter((e) => e.type === "STAMP" && !e.reversed).length - 1;
    const redeemed = rec.entries.filter((e) => e.type === "REDEMPTION" && !e.reversed).length;
    if (Math.floor(effective / REQUIRED) < redeemed) {
      return err(
        409,
        "REWARD_ALREADY_REDEEMED",
        "Reversing this stamp would leave a redeemed reward without stamps behind it. Reverse the redemption first.",
      );
    }
  }

  original.reversed = true;
  const reversal: LedgerEntry = {
    type: "REVERSAL",
    id: `00000000-0000-4000-8000-0000000b${String(rec.entries.length + Math.floor(now % 1e6)).padStart(5, "0")}`.slice(
      0,
      36,
    ),
    occurredAt: iso(now),
    staffMembershipId: ACCOUNT_ID(email),
    reversal: { targetType: kind, targetId, reason: cleaned },
  };
  rec.entries.unshift(reversal);
  const summary = derive(rec);

  records.audit.unshift({
    id: `00000000-0000-4000-8000-0000000d${String(records.audit.length).padStart(5, "0")}`.slice(
      0,
      36,
    ),
    occurredAt: iso(now),
    action: kind === "STAMP" ? "stamp.reversed" : "redemption.reversed",
    actor: {
      type: "USER",
      userId: ACCOUNT_ID(email),
      displayName: MOCK_ACCOUNTS[email].displayName,
    },
    branchId: null,
    targetType: "membership",
    targetId: rec.membershipId,
    requestId: `req-rev-${records.audit.length}`,
    // The free-text reason is kept with the reversal only, never in the audit log.
    metadata: { membershipId: rec.membershipId, reversedEventId: targetId },
  });

  const reply: Reply = {
    status: 200,
    body: {
      reversalId: reversal.id,
      target: kind,
      targetId,
      occurredAt: reversal.occurredAt,
      progress: {
        ...summary.progress,
        rewardsAvailable: summary.rewards.filter((r) => r.state === "AVAILABLE").length,
      },
      replayed: false,
    },
  };
  records.idempotency.set(idempotencyKey, { fingerprint, reply });
  return reply;
}

// ───────── audit ─────────

const DAY = 86_400_000;
const TZ_SHIFT = 3 * 3_600_000; // Africa/Addis_Ababa

/** A bare date is a whole local day; an ISO timestamp is an exact instant. */
function bound(value: unknown, end: boolean): number | null {
  if (typeof value !== "string" || !value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const start =
      Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)) - TZ_SHIFT;
    return end ? start + DAY : start;
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

export function auditList(
  records: Records,
  query: Record<string, unknown>,
  includeNetwork: boolean,
): Reply {
  const limit = Math.min(Math.max(Number(query.limit ?? 25) || 25, 1), 100);
  const offset =
    typeof query.cursor === "string" && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 0;
  const from = bound(query.from, false);
  const to = bound(query.to, true);
  if (from !== null && to !== null && from >= to) {
    return err(400, "VALIDATION_FAILED", "Request validation failed.", ["from must be before to"]);
  }
  const str = (key: string) =>
    typeof query[key] === "string" && query[key] ? (query[key] as string) : null;
  const found = records.audit
    .filter((e) => {
      const at = Date.parse(e.occurredAt);
      return (
        (from === null || at >= from) &&
        (to === null || at < to) &&
        (!str("actorUserId") || e.actor.userId === str("actorUserId")) &&
        (!str("branchId") || e.branchId === str("branchId")) &&
        (!str("action") || e.action === str("action")) &&
        (!str("actionPrefix") || e.action.startsWith(str("actionPrefix")!)) &&
        (!str("targetType") || e.targetType === str("targetType")) &&
        (!str("targetId") || e.targetId === str("targetId"))
      );
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const items = found.slice(offset, offset + limit).map((e) => {
    if (includeNetwork) return e;
    const { ip, userAgent, ...rest } = e.metadata as Record<string, unknown>;
    void ip;
    void userAgent;
    return { ...e, metadata: rest };
  });
  const next = offset + items.length;
  const page: AuditPage = {
    items,
    nextCursor: next < found.length ? String(next) : null,
  } as AuditPage;
  return { status: 200, body: page };
}
