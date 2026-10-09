import type { Customer } from "@/lib/api/contract";
import { MOCK_ACCOUNTS, type MockEmail } from "./fixtures";
import { derive, find, type CustomerRec, type Records } from "./records-data";

/**
 * Mock privacy and card tools, following backend/docs/audit-fraud-privacy.md:
 *  - viewing and exporting customer data needs `privacy:manage` and answers the same portable shape;
 *  - anonymising clears the name and phone number, closes every card and revokes wallet passes; the visit history
 *    stays but no longer points to a person; unclaimed rewards need an explicit acknowledgement (409
 *    REWARDS_OUTSTANDING); repeating the call changes nothing;
 *  - retention is 0 (off) or 6 to 120 months, applied to customers with no recent activity and no unclaimed reward;
 *  - deactivating a card, replacing it, removing wallet passes and withdrawing marketing consent need
 *    `customer:manage`.
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
const noContent = (): Reply => ({ status: 204, body: undefined });
const notFound = (what: string) => err(404, "NOT_FOUND", `${what} not found.`);

const byCustomer = (records: Records, customerId: string) =>
  records.customers.find((c) => c.customer.id === customerId);

const iso = (value: string | null) => value;

export function customerData(records: Records, customerId: string, now = Date.now()): Reply {
  const rec = byCustomer(records, customerId);
  if (!rec) return notFound("Customer");
  const membership = rec.customer.memberships[0]!;
  const consents = [
    {
      type: "MARKETING",
      action: rec.customer.marketingConsent ? "GRANTED" : "WITHDRAWN",
      version: "2026-10-v1",
      source: "ENROLLMENT",
      occurredAt: iso(rec.customer.joinedAt),
    },
  ];
  return {
    status: 200,
    body: {
      schemaVersion: 1,
      exportedAt: new Date(now).toISOString(),
      merchant: { name: "Sample Cafe" },
      customer: {
        id: rec.customer.id,
        firstName: rec.customer.firstName,
        phone: rec.phone || null,
        preferredLanguage: rec.customer.preferredLanguage,
        status: rec.phone ? "ACTIVE" : "ANONYMIZED",
        createdAt: rec.customer.joinedAt,
        anonymizedAt: rec.phone ? null : new Date(now).toISOString(),
      },
      consents,
      memberships: [
        {
          id: rec.membershipId,
          status: membership.status,
          joinedAt: membership.joinedAt,
          deactivatedAt: membership.status === "INACTIVE" ? new Date(now).toISOString() : null,
          program: { nameEn: "Coffee Card", nameAm: "የቡና ካርድ" },
          walletPasses: rec.passes.map((p) => ({
            provider: p.provider,
            status: p.status,
            createdAt: p.lastSyncedAt,
          })),
          stamps: rec.entries
            .filter((e) => e.type === "STAMP")
            .map((e) => ({
              id: e.id,
              occurredAt: e.occurredAt,
              branchName: "Bole",
              reversed: Boolean(e.reversed),
            })),
          redemptions: rec.entries
            .filter((e) => e.type === "REDEMPTION")
            .map((e) => ({
              id: e.id,
              occurredAt: e.occurredAt,
              branchName: "Bole",
              reversed: Boolean(e.reversed),
            })),
          reversals: rec.entries
            .filter((e) => e.type === "REVERSAL")
            .map((e) => ({
              occurredAt: e.occurredAt,
              targetType: e.reversal!.targetType,
              reason: e.reversal!.reason,
            })),
          rewardUnlocks: Array.from({ length: rec.unlocks }, (_, i) => ({
            unlockedAt: new Date(now - (30 - i) * 86_400_000).toISOString(),
            expiresAt: null,
          })),
          truncated: false,
        },
      ],
    },
  };
}

function anonymizeRec(rec: CustomerRec) {
  rec.customer.firstName = null;
  rec.phone = "";
  rec.customer.marketingConsent = false;
  for (const m of rec.customer.memberships) m.status = "INACTIVE";
  for (const pass of rec.passes) pass.status = "INVALIDATED";
}

const REASONS = ["CUSTOMER_REQUEST", "RETENTION_POLICY", "LEGAL_OBLIGATION", "OTHER"];

export function anonymize(records: Records, customerId: string, body: unknown): Reply {
  const rec = byCustomer(records, customerId);
  if (!rec) return notFound("Customer");
  const input = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (typeof input.reason !== "string" || !REASONS.includes(input.reason)) {
    return err(400, "VALIDATION_FAILED", "Request validation failed.", [
      "reason must be one of the following values: " + REASONS.join(", "),
    ]);
  }
  const closed = rec.customer.memberships.length;
  if (!rec.phone) {
    // Already anonymised: a harmless no-op.
    return { status: 200, body: { customerId, anonymized: true, membershipsClosed: closed } };
  }
  const available = derive(rec).rewards.filter((r) => r.state === "AVAILABLE").length;
  if (available > 0 && input.acknowledgeOutstandingRewards !== true) {
    return err(409, "REWARDS_OUTSTANDING", "The customer has unclaimed rewards.");
  }
  anonymizeRec(rec);
  return { status: 200, body: { customerId, anonymized: true, membershipsClosed: closed } };
}

export function withdrawConsent(records: Records, email: MockEmail, customerId: string): Reply {
  const rec = byCustomer(records, customerId);
  if (!rec) return notFound("Customer");
  rec.customer.marketingConsent = false;
  const canManage = (MOCK_ACCOUNTS[email].permissions as readonly string[]).includes(
    "customer:manage",
  );
  const customer: Customer = {
    ...rec.customer,
    phone: rec.phone || null,
    phoneMasked: !canManage,
  };
  return { status: 200, body: customer };
}

export function setMembershipStatus(
  records: Records,
  membershipId: string,
  active: boolean,
): Reply {
  const rec = find(records, membershipId);
  if (!rec) return notFound("Membership");
  rec.customer.memberships[0]!.status = active ? "ACTIVE" : "INACTIVE";
  return noContent();
}

export function reissueCard(records: Records, membershipId: string): Reply {
  const rec = find(records, membershipId);
  if (!rec) return notFound("Membership");
  return { status: 201, body: { token: `mock-ok-new-${Math.random().toString(36).slice(2, 10)}` } };
}

export function invalidatePasses(records: Records, membershipId: string): Reply {
  const rec = find(records, membershipId);
  if (!rec) return notFound("Membership");
  let count = 0;
  for (const pass of rec.passes) {
    if (pass.provider !== "WEB" && pass.status !== "INVALIDATED") {
      pass.status = "INVALIDATED";
      count += 1;
    }
  }
  return { status: 200, body: { invalidated: count } };
}

export function resyncPass(records: Records, passId: string): Reply {
  const pass = records.customers.flatMap((c) => c.passes).find((p) => p.id === passId);
  if (!pass) return notFound("Wallet pass");
  pass.syncStatus = "PENDING";
  return { status: 202, body: undefined };
}

export function getRetention(records: Records): Reply {
  return { status: 200, body: { inactiveCustomerMonths: records.retentionMonths } };
}

export function setRetention(records: Records, body: unknown): Reply {
  const months =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).inactiveCustomerMonths
      : undefined;
  if (
    typeof months !== "number" ||
    !Number.isInteger(months) ||
    !(months === 0 || (months >= 6 && months <= 120))
  ) {
    return err(
      422,
      "VALIDATION_FAILED",
      "inactiveCustomerMonths must be 0 (off) or between 6 and 120.",
    );
  }
  records.retentionMonths = months;
  return { status: 200, body: { inactiveCustomerMonths: months } };
}

/** Applies the period now: anonymises customers whose last stamp is older than the period and who hold no unclaimed reward. */
export function runRetention(records: Records, now = Date.now()): Reply {
  if (records.retentionMonths === 0) return { status: 200, body: { anonymized: 0, more: false } };
  const cutoff = now - records.retentionMonths * 30 * 86_400_000;
  let anonymized = 0;
  for (const rec of records.customers) {
    if (!rec.phone) continue;
    const last = Math.max(
      0,
      ...rec.entries.filter((e) => e.type !== "REVERSAL").map((e) => Date.parse(e.occurredAt)),
    );
    const stillHasReward = derive(rec).rewards.some((r) => r.state === "AVAILABLE");
    if (last < cutoff && !stillHasReward) {
      anonymizeRec(rec);
      anonymized += 1;
    }
  }
  return { status: 200, body: { anonymized, more: false } };
}
