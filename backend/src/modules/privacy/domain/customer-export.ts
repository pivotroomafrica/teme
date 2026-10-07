export const EXPORT_SCHEMA_VERSION = 1;
/** Per membership, so one very busy card cannot make an export unbounded. */
export const EXPORT_EVENT_CAP = 10_000;

export interface RawCustomerData {
  merchantName: string;
  customer: {
    id: string;
    firstName: string | null;
    phoneE164: string | null;
    preferredLanguage: string;
    status: string;
    createdAt: Date;
    anonymizedAt: Date | null;
  };
  consents: Array<{
    type: string;
    action: string;
    version: string;
    source: string;
    occurredAt: Date;
  }>;
  memberships: Array<{
    id: string;
    status: string;
    joinedAt: Date;
    deactivatedAt: Date | null;
    program: { nameEn: string; nameAm: string | null };
    walletPasses: Array<{ provider: string; status: string; createdAt: Date }>;
    stamps: Array<{ id: string; occurredAt: Date; branchName: string; reversed: boolean }>;
    redemptions: Array<{ id: string; occurredAt: Date; branchName: string; reversed: boolean }>;
    reversals: Array<{ occurredAt: Date; targetType: string; reason: string }>;
    rewardUnlocks: Array<{ unlockedAt: Date; expiresAt: Date | null }>;
  }>;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * The portable copy of everything stored about one customer at one merchant. It deliberately leaves out
 * everything that is not the customer's data or that could expose someone else: staff identities, card-token
 * hashes, wallet barcodes, device tokens, internal ids of other tenants. Event ids are kept so the customer
 * can refer to a specific visit.
 */
export function buildCustomerExport(data: RawCustomerData, exportedAt: Date) {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: exportedAt.toISOString(),
    merchant: { name: data.merchantName },
    customer: {
      id: data.customer.id,
      firstName: data.customer.firstName,
      phone: data.customer.phoneE164,
      preferredLanguage: data.customer.preferredLanguage,
      status: data.customer.status,
      createdAt: iso(data.customer.createdAt),
      anonymizedAt: iso(data.customer.anonymizedAt),
    },
    consents: data.consents.map((c) => ({ ...c, occurredAt: iso(c.occurredAt) })),
    memberships: data.memberships.map((m) => ({
      id: m.id,
      status: m.status,
      joinedAt: iso(m.joinedAt),
      deactivatedAt: iso(m.deactivatedAt),
      program: m.program,
      walletPasses: m.walletPasses.map((p) => ({ ...p, createdAt: iso(p.createdAt) })),
      stamps: m.stamps.map((s) => ({ ...s, occurredAt: iso(s.occurredAt) })),
      redemptions: m.redemptions.map((r) => ({ ...r, occurredAt: iso(r.occurredAt) })),
      reversals: m.reversals.map((r) => ({ ...r, occurredAt: iso(r.occurredAt) })),
      rewardUnlocks: m.rewardUnlocks.map((u) => ({
        unlockedAt: iso(u.unlockedAt),
        expiresAt: iso(u.expiresAt),
      })),
      truncated: m.stamps.length >= EXPORT_EVENT_CAP || m.redemptions.length >= EXPORT_EVENT_CAP,
    })),
  };
}

export type CustomerExport = ReturnType<typeof buildCustomerExport>;

export const ANONYMIZATION_REASONS = [
  'CUSTOMER_REQUEST',
  'RETENTION_POLICY',
  'LEGAL_OBLIGATION',
  'OTHER',
] as const;
export type AnonymizationReason = (typeof ANONYMIZATION_REASONS)[number];
