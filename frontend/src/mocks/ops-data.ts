import type { AuditPage, DeadJob, PlatformMerchant } from "@/lib/api/contract";
import { MOCK_ACCOUNTS } from "./fixtures";

/**
 * Mock platform operations, following backend/src/modules/{merchants,jobs,audit-viewer}:
 *  - the merchant list is organisation-level data only (no customers, stamps or programs);
 *  - the outbox shows counts by status and the dead jobs; re-queueing a dead job gives it a fresh set of attempts
 *    and is audited as `outbox.job_requeued`; an unknown job, or one that is not dead, is 404;
 *  - the platform audit shows platform-level events only, unless a merchant is named. Naming a merchant is itself
 *    recorded as `audit.platform_accessed`, and an unknown merchant is 404.
 * Error text of dead jobs deliberately contains bait credentials: the real backend scrubs them, and the screens
 * must keep them hidden even if one ever slipped through.
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

const iso = (ms: number) => new Date(ms).toISOString();
const ADMIN = MOCK_ACCOUNTS["admin@mock.test"];
const hex = (n: number, width = 4) => String(n).padStart(width, "0");

export type AuditRow = AuditPage["items"][number] & { merchantId: string | null };

export interface OpsStore {
  merchants: PlatformMerchant[];
  dead: DeadJob[];
  counts: Record<string, number>;
  audit: AuditRow[];
}
export type OpsStores = Map<string, OpsStore>;

const NAMES: Array<[string, string | null, PlatformMerchant["status"]]> = [
  ["Sample Cafe", "ናሙና ካፌ", "ACTIVE"],
  ["Bole Bakery", "ቦሌ ዳቦ ቤት", "ACTIVE"],
  ["Piassa Pharmacy", null, "SUSPENDED"],
  ["Old Tea House", "የድሮ ሻይ ቤት", "DEACTIVATED"],
  ["Mercato Mart", null, "ACTIVE"],
  ["Entoto Books", "እንጦጦ መጻሕፍት", "ACTIVE"],
  ["Kazanchis Kitchen", null, "ACTIVE"],
  ["Sidist Salon", null, "SUSPENDED"],
  ["Megenagna Market", null, "ACTIVE"],
  ["Lideta Laundry", null, "ACTIVE"],
  ["Arat Kilo Gifts", null, "DEACTIVATED"],
  ["Gerji Gym", null, "ACTIVE"],
];

function seed(now: number): OpsStore {
  const merchants = NAMES.map(([nameEn, nameAm, status], i): PlatformMerchant => ({
    id: `00000000-0000-4000-8000-0000000a${hex(i + 1)}`,
    slug: nameEn.toLowerCase().replace(/[^a-z]+/g, "-"),
    nameEn,
    nameAm,
    status,
  }));

  const dead: DeadJob[] = [
    ["wallet.pass_update", "Apple Wallet push failed with 403. token=BAIT-SECRET-TOKEN"],
    [
      "wallet.pass_update",
      "Google Wallet request rejected: Authorization: Bearer BAIT.BEARER.VALUE",
    ],
    ["wallet.pass_update", "Timeout after 5 attempts contacting the provider."],
    ["fraud.evaluate", "password=BAIT-PASSWORD could not be used"],
  ].map(([type, lastError], i) => ({
    id: `00000000-0000-4000-8000-0000000e${hex(i + 1)}`,
    merchantId: merchants[i % 3]!.id,
    type: type!,
    aggregateType: type!.startsWith("wallet") ? "wallet_pass" : "merchant",
    aggregateId: `00000000-0000-4000-8000-0000000f${hex(i + 1)}`,
    attempts: 5,
    lastError: lastError!,
    createdAt: iso(now - (i + 1) * 3_600_000),
  }));

  const row = (
    i: number,
    action: string,
    minutesAgo: number,
    merchantId: string | null,
    extra: Partial<AuditRow> = {},
  ): AuditRow => ({
    id: `00000000-0000-4000-8000-0000000d${hex(i)}`,
    occurredAt: iso(now - minutesAgo * 60_000),
    action,
    actor: { type: "USER", userId: ADMIN.id, displayName: ADMIN.displayName },
    branchId: null,
    targetType: null,
    targetId: null,
    requestId: `req-ops-${i}`,
    metadata: {},
    merchantId,
    ...extra,
  });

  const platformEvents: AuditRow[] = [
    row(1, "platform.admin_bootstrapped", 60 * 24 * 20, null),
    row(2, "platform.merchant_bootstrapped", 60 * 24 * 19, null, {
      targetType: "merchant",
      targetId: merchants[0]!.id,
    }),
    row(3, "user.deactivated", 60 * 24 * 3, null, {
      targetType: "user",
      targetId: "00000000-0000-4000-8000-00000000d1d1",
    }),
    row(4, "outbox.job_requeued", 60 * 12, merchants[1]!.id, {
      targetType: "outbox_job",
      metadata: { type: "wallet.pass_update", token: "BAIT-AUDIT-TOKEN" },
    }),
    ...Array.from({ length: 24 }, (_, k) =>
      row(
        10 + k,
        k % 2 ? "audit.platform_accessed" : "outbox.job_requeued",
        60 * (30 + k * 7),
        null,
        {
          targetType: k % 2 ? "merchant" : "outbox_job",
        },
      ),
    ),
  ];

  const merchantEvents: AuditRow[] = merchants.slice(0, 4).flatMap((m, mi) =>
    [
      ["customer.anonymized", 60 * 30],
      ["customer.marketing_consent_withdrawn", 60 * 50],
      ["customer.data_exported", 60 * 70],
      ["customer.data_viewed", 60 * 90],
      ["staff.invited", 60 * 110],
      ["program.updated", 60 * 130],
      ["stamp.issued", 60 * 150],
    ].map(([action, minutes], k) =>
      row(100 + mi * 20 + k, action as string, minutes as number, m.id, {
        actor: { type: "USER", userId: `owner-${mi}`, displayName: `${m.nameEn} Owner` },
        targetType: String(action).startsWith("customer") ? "customer" : null,
        targetId: String(action).startsWith("customer")
          ? `00000000-0000-4000-8000-0000000c${hex(k)}`
          : null,
        metadata: { ip: "10.0.0.9", userAgent: "BaitBrowser/1.0" },
      }),
    ),
  );

  return {
    merchants,
    dead,
    counts: { PENDING: 3, PROCESSING: 1, COMPLETED: 240, FAILED: 2, DEAD: dead.length },
    audit: [...platformEvents, ...merchantEvents].sort((a, b) =>
      b.occurredAt.localeCompare(a.occurredAt),
    ),
  };
}

export function opsFor(stores: OpsStores, email: string, now = Date.now()): OpsStore {
  let store = stores.get(email);
  if (!store) {
    store = seed(now);
    stores.set(email, store);
  }
  return store;
}

export const listMerchants = (store: OpsStore): Reply => ({ status: 200, body: store.merchants });
export const outboxStats = (store: OpsStore): Reply => ({ status: 200, body: store.counts });
export const deadJobs = (store: OpsStore): Reply => ({ status: 200, body: store.dead });

export function requeueDead(store: OpsStore, jobId: string, now = Date.now()): Reply {
  const index = store.dead.findIndex((j) => j.id === jobId);
  if (index < 0) return err(404, "NOT_FOUND", "Dead job not found.");
  const [job] = store.dead.splice(index, 1);
  store.counts.DEAD = Math.max(0, (store.counts.DEAD ?? 1) - 1);
  store.counts.PENDING = (store.counts.PENDING ?? 0) + 1;
  store.audit.unshift({
    id: `00000000-0000-4000-8000-0000000d${hex(900 + store.audit.length)}`,
    occurredAt: iso(now),
    action: "outbox.job_requeued",
    actor: { type: "USER", userId: ADMIN.id, displayName: ADMIN.displayName },
    branchId: null,
    targetType: "outbox_job",
    targetId: jobId,
    requestId: "req-requeue",
    metadata: { type: job!.type },
    merchantId: job!.merchantId,
  });
  return { status: 200, body: { ...job!, attempts: 0, lastError: null } };
}

const DAY = 86_400_000;
const TZ_SHIFT = 3 * 3_600_000;
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

export function platformAudit(
  store: OpsStore,
  query: Record<string, unknown>,
  now = Date.now(),
): Reply {
  const limit = Math.min(Math.max(Number(query.limit ?? 25) || 25, 1), 100);
  const offset =
    typeof query.cursor === "string" && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 0;
  const str = (key: string) =>
    typeof query[key] === "string" && query[key] ? (query[key] as string) : null;
  const merchantId = str("merchantId");
  if (merchantId && !store.merchants.some((m) => m.id === merchantId)) {
    return err(404, "NOT_FOUND", "Merchant not found.");
  }
  const from = bound(query.from, false);
  const to = bound(query.to, true);
  if (from !== null && to !== null && from >= to) {
    return err(400, "VALIDATION_FAILED", "Request validation failed.", ["from must be before to"]);
  }
  if (merchantId) {
    // Naming a merchant is itself recorded, as the backend does.
    store.audit.unshift({
      id: `00000000-0000-4000-8000-0000000d${hex(800 + store.audit.length)}`,
      occurredAt: iso(now),
      action: "audit.platform_accessed",
      actor: { type: "USER", userId: ADMIN.id, displayName: ADMIN.displayName },
      branchId: null,
      targetType: "merchant",
      targetId: merchantId,
      requestId: "req-platform-audit",
      metadata: { scope: "merchant" },
      merchantId,
    });
  }
  const found = store.audit
    .filter((e) => {
      const at = Date.parse(e.occurredAt);
      return (
        // Without a merchant: platform-level events only.
        (merchantId ? e.merchantId === merchantId : e.merchantId === null) &&
        (from === null || at >= from) &&
        (to === null || at < to) &&
        (!str("action") || e.action === str("action")) &&
        (!str("actionPrefix") || e.action.startsWith(str("actionPrefix")!)) &&
        (!str("targetType") || e.targetType === str("targetType")) &&
        (!str("targetId") || e.targetId === str("targetId")) &&
        (!str("actorUserId") || e.actor.userId === str("actorUserId"))
      );
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const items = found.slice(offset, offset + limit).map(({ merchantId: _m, ...rest }) => {
    void _m;
    return rest;
  });
  const next = offset + items.length;
  return { status: 200, body: { items, nextCursor: next < found.length ? String(next) : null } };
}
