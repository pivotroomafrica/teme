/**
 * Response contract: runtime validation + exact types for the answers the UI depends on.
 *
 * Why this exists next to the generated types: the backend's OpenAPI document describes request bodies fully
 * but leaves many response fields as bare `object` (92 of them) and omits some response bodies entirely
 * (for example POST /card/web). Generated types alone would make the UI work with `unknown`. Each schema
 * below is therefore tagged:
 *
 *   OPENAPI-GAP  the generated type is missing or too vague; this schema fills it in from the backend source.
 *                Delete it (and use the generated type) once the backend documents the response.
 *   ALIGNED      the OpenAPI document is complete; the schema only adds runtime validation. A compile-time
 *                check (contract.test-d.ts) fails the build if it ever drifts from the generated type.
 *
 * A second, systemic gap: 69 nullable fields across the spec (e.g. BranchDto.nameAm, SessionUserDto.merchantId)
 * are typed `Record<string, never> | null` instead of `string | null`. Schemas here use the real type; the
 * compile-time check treats that one difference as expected.
 *
 * Every schema validates what the browser is about to trust, so a backend change that breaks the contract
 * surfaces as a clear "malformed response" error instead of a crash in a component.
 */
import { z } from "zod";

const nullableString = z.string().nullable();
const message = z.object({ en: z.string(), am: z.string() });

// ───────────────────────── Authentication (ALIGNED with SessionDto / MeDto) ─────────────────────────

export const sessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  tokenType: z.string(),
  expiresIn: z.number().int().positive(),
  user: z.object({
    id: z.string(),
    displayName: z.string(),
    accountType: z.enum(["PLATFORM_ADMIN", "MERCHANT_USER"]),
    role: z.string(),
    merchantId: nullableString,
  }),
});
export type Session = z.infer<typeof sessionSchema>;

// OPENAPI-GAP: MeDto.branchScope is documented only in prose.
export const meSchema = z.object({
  userId: z.string(),
  kind: z.enum(["platform", "merchant"]),
  role: z.string(),
  merchantId: nullableString,
  permissions: z.array(z.string()),
  /** "ALL", or the ids of the branches this account may operate at. */
  branchScope: z.union([z.literal("ALL"), z.array(z.string())]).nullable(),
});
export type Me = z.infer<typeof meSchema>;

// ───────────────────────── Public enrollment (OPENAPI-GAP: nested objects are bare `object`) ─────────────────────────

export const walletOptionSchema = z.object({
  provider: z.enum(["WEB", "APPLE", "GOOGLE"]),
  available: z.boolean(),
  reason: z.enum(["NOT_CONFIGURED"]).nullable(),
  addUrl: nullableString,
});
export type WalletOption = z.infer<typeof walletOptionSchema>;

const joinInfoShape = {
  merchant: z.object({
    nameEn: z.string(),
    nameAm: nullableString,
    defaultLanguage: z.enum(["EN", "AM"]),
  }),
  program: z.object({
    nameEn: z.string(),
    nameAm: nullableString,
    stampsRequired: z.number().int().positive(),
    brandColor: nullableString,
    cardDisplay: z.record(z.string(), z.unknown()),
    termsEn: nullableString,
    termsAm: nullableString,
    reward: z
      .object({
        nameEn: z.string(),
        nameAm: nullableString,
        descriptionEn: nullableString,
        descriptionAm: nullableString,
      })
      .nullable(),
  }),
  consent: z.object({ version: z.string() }),
  wallet: z.array(walletOptionSchema),
};

export const joinInfoSchema = z.object(joinInfoShape);
export type JoinInfo = z.infer<typeof joinInfoSchema>;

export const enrollmentResultSchema = z.object({
  ...joinInfoShape,
  status: z.enum(["CREATED", "EXISTING"]),
  /** Echo of what was submitted; never stored data about an existing customer. */
  customer: z.object({ firstName: z.string(), preferredLanguage: z.enum(["EN", "AM"]) }),
  /** The opaque card token (QR value). Present once, only for a new membership. */
  card: z.object({ token: z.string().min(1) }).nullable(),
});
export type EnrollmentResult = z.infer<typeof enrollmentResultSchema>;

// ───────────────────────── Customer card (OPENAPI-GAP: POST /card/web has no response body in the spec) ─────────────────────────

const progressShape = {
  current: z.number().int().nonnegative(),
  required: z.number().int().positive(),
  remaining: z.number().int().nonnegative(),
  completedCards: z.number().int().nonnegative(),
};

export const webCardSchema = z.object({
  merchant: z.object({ nameEn: z.string(), nameAm: nullableString }),
  program: z.object({
    nameEn: z.string(),
    nameAm: nullableString,
    brandColor: nullableString,
    termsEn: z.string(),
    termsAm: nullableString,
  }),
  customer: z.object({ firstName: nullableString, preferredLanguage: z.enum(["EN", "AM"]) }),
  progress: z.object(progressShape),
  rewardsAvailable: z.number().int().nonnegative(),
  reward: z
    .object({
      nameEn: z.string(),
      nameAm: nullableString,
      descriptionEn: z.string(),
      descriptionAm: nullableString,
    })
    .nullable(),
  status: z.enum(["ACTIVE", "SUSPENDED", "INVALIDATED", "PENDING"]),
  /** The value to render as the QR code: the card token itself. Never computed in the browser. */
  barcode: z.string(),
  version: z.number().int(),
});
export type WebCard = z.infer<typeof webCardSchema>;

// ALIGNED with WalletLinkResultDto
export const walletLinkResultSchema = z.object({
  provider: z.enum(["APPLE", "GOOGLE", "WEB"]),
  kind: z.enum(["DOWNLOAD", "REDIRECT", "NONE"]),
  url: nullableString,
  expiresAt: nullableString,
});
export type WalletLinkResult = z.infer<typeof walletLinkResultSchema>;

// ───────────────────────── Scanner (OPENAPI-GAP: customer/progress/stamp/reward are bare `object`) ─────────────────────────

export const REJECTION_REASONS = [
  "BRANCH_NOT_PERMITTED",
  "INVALID_TOKEN",
  "MEMBERSHIP_INACTIVE",
  "PROGRAM_INACTIVE",
  "COOLDOWN_ACTIVE",
  "NO_REWARD_AVAILABLE",
  "REWARD_NOT_AVAILABLE",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];
const rejectionReason = z.enum(REJECTION_REASONS);

const scanProgress = z.object({
  ...progressShape,
  rewardsAvailable: z.number().int().nonnegative(),
});

export const scanResultSchema = z.object({
  outcome: z.enum(["ELIGIBLE", "STAMPED", "REJECTED"]),
  reason: rejectionReason.nullable(),
  message: message,
  retryAfterSeconds: z.number().int().nonnegative().optional(),
  customer: z.object({ firstName: nullableString }).optional(),
  progress: scanProgress.optional(),
  stamp: z.object({ id: z.string(), occurredAt: z.string() }).optional(),
  reward: z
    .object({
      unlocked: z.boolean(),
      unlockId: z.string().optional(),
      nameEn: z.string().optional(),
      nameAm: nullableString.optional(),
      expiresAt: nullableString.optional(),
    })
    .optional(),
  wouldUnlockReward: z.boolean().optional(),
  replayed: z.boolean(),
});
export type ScanResult = z.infer<typeof scanResultSchema>;

export const publicRewardSchema = z.object({
  unlockId: z.string(),
  nameEn: z.string(),
  nameAm: nullableString,
  descriptionEn: nullableString,
  descriptionAm: nullableString,
  unlockedAt: z.string(),
  expiresAt: nullableString,
});
export type PublicReward = z.infer<typeof publicRewardSchema>;

export const redeemResultSchema = z.object({
  outcome: z.enum(["AVAILABLE", "REDEEMED", "REJECTED"]),
  reason: rejectionReason.nullable(),
  message: message,
  customer: z.object({ firstName: nullableString }).optional(),
  rewards: z.array(publicRewardSchema).optional(),
  reward: publicRewardSchema.optional(),
  redemption: z.object({ id: z.string(), occurredAt: z.string() }).optional(),
  progress: scanProgress.optional(),
  replayed: z.boolean(),
});
export type RedeemResult = z.infer<typeof redeemResultSchema>;

/** Returns a parser for Transport specs: `parse: parseWith(scanResultSchema)`. */
export const parseWith =
  <S extends z.ZodType>(schema: S) =>
  (data: unknown): z.infer<S> =>
    schema.parse(data);

// ───────────────────────── Merchant profile (OPENAPI-GAP: nullable fields typed wrongly) ─────────────────────────

/** Only what the shells need to name the business. */
export const merchantProfileSchema = z.object({
  nameEn: z.string(),
  nameAm: nullableString,
  /** IANA time zone every date range and month on the dashboard is read in. */
  timezone: z.string().default("Africa/Addis_Ababa"),
  /** Public reference used in customer join links (not an internal identifier). */
  joinReference: z.string().optional(),
  // The rest is what the settings screen edits; the shells above need none of it.
  slug: z.string().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVATED"]).optional(),
  defaultLanguage: z.enum(["EN", "AM"]).optional(),
  supportEmail: nullableString.optional(),
  supportPhone: nullableString.optional(),
  /** Metadata only: the service has no file storage yet, so a logo cannot actually be uploaded. */
  logo: z.object({ storageKey: z.string(), contentType: z.string() }).nullish(),
  programDefaults: z.object({ stampsRequired: z.number(), cooldownMinutes: z.number() }).optional(),
});
export type MerchantProfile = z.infer<typeof merchantProfileSchema>;

// ───────────────────────── Customer search (OPENAPI-GAP: nullable fields typed wrongly) ─────────────────────────

export const customerSchema = z.object({
  id: z.string(),
  firstName: nullableString,
  /** Masked (some digits hidden) when `phoneMasked` is true, which is always the case for branch staff. */
  phone: nullableString,
  phoneMasked: z.boolean(),
  preferredLanguage: z.enum(["EN", "AM"]),
  joinedAt: z.string(),
  marketingConsent: z.boolean(),
  memberships: z.array(
    z.object({
      id: z.string(),
      programId: z.string(),
      status: z.enum(["ACTIVE", "INACTIVE"]),
      joinedAt: z.string(),
    }),
  ),
});
export type Customer = z.infer<typeof customerSchema>;

export const customerPageSchema = z.object({
  items: z.array(customerSchema),
  nextCursor: z.string().nullable(),
});
export type CustomerPage = z.infer<typeof customerPageSchema>;

// ───────────────────────── Analytics and audit (OPENAPI-GAP: the spec has no response bodies for these) ─────────────────────────
// Shapes follow backend/docs/analytics.md and the backend services. Ratios are null, never 0, when the denominator is 0.

const ratio = z.number().nullable();

export const analyticsRangeSchema = z.object({
  from: z.string(),
  to: z.string(),
  timeZone: z.string(),
  programId: nullableString,
});

export const analyticsOverviewSchema = z.object({
  range: analyticsRangeSchema,
  newMembers: z.number(),
  activeMembers: z.number(),
  returningCustomers: z.number(),
  stampsIssued: z.object({ count: z.number(), reversed: z.number() }),
  rewardsUnlocked: z.number(),
  rewardsRedeemed: z.number(),
  redemptionRate: ratio,
  averageVisitsPerActiveMember: ratio,
  timeBetweenVisits: z.object({
    intervals: z.number(),
    averageHours: ratio,
    medianHours: ratio,
    p90Hours: ratio,
  }),
});
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;

export const monthlyReturningSchema = z.object({
  metric: z.string(),
  timeZone: z.string(),
  month: z.string(),
  value: z.number(),
  series: z.array(
    z.object({
      month: z.string(),
      returningCustomers: z.number(),
      activeMembers: z.number(),
      returningShare: ratio,
      /** True for the current month: it is not over yet. */
      partial: z.boolean(),
    }),
  ),
});
export type MonthlyReturning = z.infer<typeof monthlyReturningSchema>;

export const branchActivityPageSchema = z.object({
  range: analyticsRangeSchema,
  items: z.array(
    z.object({
      branchId: z.string(),
      nameEn: z.string(),
      nameAm: nullableString,
      stamps: z.number(),
      uniqueCustomers: z.number(),
      redemptions: z.number(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type BranchActivityPage = z.infer<typeof branchActivityPageSchema>;

export const walletHealthSchema = z.object({
  range: analyticsRangeSchema,
  activeMemberships: z.number(),
  providers: z.array(
    z.object({
      provider: z.enum(["APPLE", "GOOGLE", "WEB"]),
      memberships: z.number(),
      adoptionRate: ratio,
    }),
  ),
  passSync: z.array(z.object({ status: z.string(), passes: z.number() })),
  updates: z.object({
    succeeded: z.number(),
    failed: z.number(),
    stillQueued: z.number(),
    succeededAfterRetry: z.number(),
    successRate: ratio,
  }),
});
export type WalletHealth = z.infer<typeof walletHealthSchema>;

export const metricDefinitionsSchema = z.array(
  z.object({ key: z.string(), name: z.string(), definition: z.string() }),
);
export type MetricDefinitions = z.infer<typeof metricDefinitionsSchema>;

export const auditPageSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      occurredAt: z.string(),
      action: z.string(),
      actor: z.object({
        type: z.enum(["USER", "SYSTEM"]),
        userId: nullableString,
        displayName: nullableString,
      }),
      branchId: nullableString,
      targetType: nullableString,
      targetId: nullableString,
      requestId: nullableString.optional(),
      /** Safe metadata only, already cleaned by the backend; the screen filters it again before showing it. */
      metadata: z.record(z.string(), z.unknown()).nullish(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type AuditPage = z.infer<typeof auditPageSchema>;

// ───────────────────────── Loyalty programs (OPENAPI-GAP: nullable fields typed wrongly) ─────────────────────────

export const STAMP_ICONS = ["coffee", "star", "heart", "check", "gift"] as const;
export type StampIcon = (typeof STAMP_ICONS)[number];

export const programSchema = z.object({
  id: z.string(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]),
  isDefault: z.boolean(),
  nameEn: z.string(),
  nameAm: nullableString,
  termsEn: nullableString,
  termsAm: nullableString,
  stampsRequired: z.number(),
  cooldownMinutes: z.number(),
  brandColor: nullableString,
  cardDisplay: z.object({
    title: z.string().optional(),
    subtitle: z.string().optional(),
    stampIcon: z.enum(STAMP_ICONS).optional(),
    showProgressText: z.boolean().optional(),
  }),
  reward: z
    .object({
      id: z.string(),
      nameEn: z.string(),
      nameAm: nullableString,
      descriptionEn: nullableString,
      descriptionAm: nullableString,
      validForDays: z.number().nullable(),
    })
    .nullable(),
  /** Customers enrolled. When above zero the stamp requirement is locked. */
  memberCount: z.number(),
  stampsRequiredLocked: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Program = z.infer<typeof programSchema>;
export type ProgramStatus = Program["status"];

export const programListSchema = z.array(programSchema);

// ───────────────────────── Branches and staff (OPENAPI-GAP: nullable fields typed wrongly) ─────────────────────────

export const branchSchema = z.object({
  id: z.string(),
  nameEn: z.string(),
  nameAm: nullableString,
  addressText: nullableString,
  city: nullableString,
  phoneE164: nullableString,
  status: z.enum(["ACTIVE", "INACTIVE"]),
});
export type Branch = z.infer<typeof branchSchema>;
export const branchListSchema = z.array(branchSchema);

export const MERCHANT_ROLES = ["OWNER", "MANAGER", "STAFF"] as const;
export type MerchantRole = (typeof MERCHANT_ROLES)[number];

/** A team member as the backend shows it: no password, no hashes, no security details. */
export const staffSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string(),
  roleKey: z.enum(MERCHANT_ROLES),
  status: z.enum(["INVITED", "ACTIVE", "DEACTIVATED"]),
  branchIds: z.array(z.string()),
});
export type Staff = z.infer<typeof staffSchema>;
export const staffListSchema = z.array(staffSchema);

export const invitedStaffSchema = z.object({
  staff: staffSchema,
  invitation: z.object({
    /** One-time secret, returned only by this response. */
    token: z.string(),
    expiresAt: z.string(),
  }),
});
export type InvitedStaff = z.infer<typeof invitedStaffSchema>;

export const staffActivitySchema = z.object({
  staff: z.object({
    id: z.string(),
    displayName: z.string(),
    roleKey: z.string(),
    status: z.string(),
  }),
  summary: z.object({
    stampsIssued: z.number(),
    redemptionsProcessed: z.number(),
    reversalsPerformed: z.number(),
    lastActiveAt: z.string().nullable(),
  }),
  events: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        action: z.string(),
        targetType: nullableString,
        targetId: nullableString,
        branchId: nullableString,
        occurredAt: z.string(),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
});
export type StaffActivity = z.infer<typeof staffActivitySchema>;

// ───────────────────────── Memberships, rewards, ledger, wallet passes, reversals (OPENAPI-GAP: no response bodies) ─────────────────────────
// Shapes follow backend/docs/rewards-and-reversals.md and the backend services.

export const REWARD_STATES = ["AVAILABLE", "REDEEMED", "EXPIRED", "REVERSED"] as const;
export type RewardState = (typeof REWARD_STATES)[number];

export const membershipSummarySchema = z.object({
  membershipId: z.string(),
  status: z.string(),
  effectiveStamps: z.number(),
  progress: z.object({
    current: z.number(),
    required: z.number(),
    remaining: z.number(),
    completedCards: z.number(),
  }),
  rewards: z.array(
    z.object({
      id: z.string(),
      state: z.enum(REWARD_STATES),
      unlockedAt: z.string(),
      expiresAt: nullableString,
      nameEn: z.string(),
      nameAm: nullableString,
      descriptionEn: nullableString,
      descriptionAm: nullableString,
      redemptionAttempts: z.number(),
      redemption: z.object({ id: z.string(), occurredAt: z.string() }).nullable(),
    }),
  ),
});
export type MembershipSummary = z.infer<typeof membershipSummarySchema>;

export const ledgerEntrySchema = z.object({
  type: z.enum(["STAMP", "REDEMPTION", "REVERSAL"]),
  id: z.string(),
  occurredAt: z.string(),
  branchId: z.string().optional(),
  staffMembershipId: z.string(),
  /** STAMP and REDEMPTION: a compensating reversal exists. The original row itself is never changed. */
  reversed: z.boolean().optional(),
  rewardUnlockId: z.string().optional(),
  reversal: z
    .object({
      targetType: z.enum(["STAMP", "REDEMPTION"]),
      targetId: z.string(),
      reason: z.string(),
    })
    .optional(),
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export const ledgerSchema = z.object({
  summary: membershipSummarySchema,
  entries: z.array(ledgerEntrySchema),
});
export type Ledger = z.infer<typeof ledgerSchema>;

export const walletPassSchema = z.object({
  id: z.string(),
  provider: z.enum(["APPLE", "GOOGLE", "WEB"]),
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "INVALIDATED"]),
  syncStatus: z.enum(["PENDING", "SYNCED", "FAILED"]),
  passVersion: z.number(),
  lastSyncedVersion: z.number(),
  lastSyncedAt: nullableString,
});
export type WalletPass = z.infer<typeof walletPassSchema>;
export const walletPassListSchema = z.array(walletPassSchema);

export const reversalResultSchema = z.object({
  reversalId: z.string(),
  target: z.enum(["STAMP", "REDEMPTION"]),
  targetId: z.string(),
  occurredAt: z.string(),
  progress: z.record(z.string(), z.number()),
  replayed: z.boolean(),
});
export type ReversalResult = z.infer<typeof reversalResultSchema>;

// ───────────────────────── Staff activity and retention cohorts (OPENAPI-GAP: no response bodies in the spec) ─────────────────────────
// Shapes follow backend/src/modules/analytics/application/analytics.service.ts. Loyalty activity only: no money fields.

export const staffActivityPageSchema = z.object({
  range: analyticsRangeSchema,
  items: z.array(
    z.object({
      staffId: z.string(),
      displayName: z.string(),
      role: z.string(),
      status: z.string(),
      stamps: z.number(),
      stampsReversed: z.number(),
      reversalRate: ratio,
      uniqueCustomers: z.number(),
      redemptions: z.number(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type StaffActivityPage = z.infer<typeof staffActivityPageSchema>;

export const cohortsSchema = z.object({
  timeZone: z.string(),
  programId: nullableString,
  cohorts: z.array(
    z.object({
      /** Local calendar month the members joined, YYYY-MM. */
      cohortMonth: z.string(),
      size: z.number(),
      /** Month 0 is the joining month; months that have not happened yet are not listed. */
      retention: z.array(z.object({ monthOffset: z.number(), retained: z.number(), rate: ratio })),
    }),
  ),
});
export type Cohorts = z.infer<typeof cohortsSchema>;

// ───────────────────────── Platform operations (OPENAPI-GAP: the spec has no response bodies) ─────────────────────────
// Shapes follow backend/src/modules/merchants/api/platform-merchants.controller.ts, jobs/api/outbox-admin.controller.ts
// and docs/operations.md. Organisation-level data only: no customer data is reachable from these routes.

export const MERCHANT_STATUSES = ["ACTIVE", "SUSPENDED", "DEACTIVATED"] as const;

export const platformMerchantSchema = z.object({
  id: z.string(),
  slug: z.string(),
  nameEn: z.string(),
  nameAm: nullableString,
  status: z.enum(MERCHANT_STATUSES),
});
export type PlatformMerchant = z.infer<typeof platformMerchantSchema>;
export const platformMerchantListSchema = z.array(platformMerchantSchema);

/** Job counts by status, e.g. { PENDING: 0, COMPLETED: 10, FAILED: 1, DEAD: 0 }. Only statuses that exist are present. */
export const outboxStatsSchema = z.record(z.string(), z.number());
export type OutboxStats = z.infer<typeof outboxStatsSchema>;

export const deadJobSchema = z.object({
  id: z.string(),
  merchantId: nullableString,
  type: z.string(),
  aggregateType: nullableString,
  aggregateId: nullableString,
  attempts: z.number(),
  /** Already scrubbed of credentials by the backend; the screen cleans it again before showing it. */
  lastError: nullableString,
  createdAt: z.string(),
});
export type DeadJob = z.infer<typeof deadJobSchema>;
export const deadJobListSchema = z.array(deadJobSchema);

export const healthSchema = z.object({ status: z.string() }).passthrough();
export type Health = z.infer<typeof healthSchema>;

// ───────────────────────── Fraud monitoring (OPENAPI-GAP for settings and evaluate responses) ─────────────────────────
// Shapes follow backend/src/modules/fraud. Indicators only FLAG things for a person to review: nothing is blocked.

export const FRAUD_INDICATORS = [
  "EXCESSIVE_STAMPS_BY_STAFF",
  "REPEATED_SCANS_FOR_MEMBERSHIP",
  "UNUSUAL_BRANCH_ACTIVITY",
  "HIGH_REVERSAL_RATE",
  "REPEATED_COOLDOWN_REJECTIONS",
  "EXCESSIVE_REDEMPTIONS",
] as const;
export type FraudIndicator = (typeof FRAUD_INDICATORS)[number];
export const FLAG_STATUSES = ["OPEN", "DISMISSED", "CONFIRMED"] as const;

export const fraudFlagSchema = z.object({
  id: z.string(),
  indicator: z.enum(FRAUD_INDICATORS),
  subjectType: z.enum(["STAFF", "MEMBERSHIP", "BRANCH"]),
  subjectId: z.string(),
  /** Staff name, branch name or customer first name. */
  subjectLabel: nullableString,
  windowStart: z.string(),
  windowEnd: z.string(),
  /** What was measured: a count, or a 0-1 ratio for HIGH_REVERSAL_RATE. */
  observed: z.number(),
  /** The limit it exceeded. */
  threshold: z.number(),
  /** Counts behind the flag. Contains no personal data. */
  details: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(FLAG_STATUSES),
  reviewedAt: nullableString,
  reviewNote: nullableString,
  createdAt: z.string(),
});
export type FraudFlag = z.infer<typeof fraudFlagSchema>;

export const fraudFlagPageSchema = z.object({
  items: z.array(fraudFlagSchema),
  nextCursor: z.string().nullable(),
});
export type FraudFlagPage = z.infer<typeof fraudFlagPageSchema>;

/** { indicatorKey: { enabled, ...numbers } }, defaults merged with the merchant's own values. */
export const fraudThresholdsSchema = z.record(
  z.string(),
  z.record(z.string(), z.union([z.boolean(), z.number()])),
);
export type FraudThresholds = z.infer<typeof fraudThresholdsSchema>;

export const fraudEvaluationSchema = z.record(z.string(), z.unknown());

// ───────────────────────── Privacy and customer card tools (OPENAPI-GAP: no response bodies in the spec) ─────────────────────────
// Shapes follow backend/src/modules/privacy and memberships.

export const ANONYMIZATION_REASONS = [
  "CUSTOMER_REQUEST",
  "RETENTION_POLICY",
  "LEGAL_OBLIGATION",
  "OTHER",
] as const;

export const retentionPolicySchema = z.object({ inactiveCustomerMonths: z.number() });
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

export const retentionRunSchema = z.object({ anonymized: z.number(), more: z.boolean() });
export type RetentionRun = z.infer<typeof retentionRunSchema>;

export const anonymizeResultSchema = z.object({
  customerId: z.string(),
  anonymized: z.boolean(),
  membershipsClosed: z.number(),
});
export type AnonymizeResult = z.infer<typeof anonymizeResultSchema>;

/** Everything stored about one customer at one merchant (the same shape as the portable export). */
export const customerDataSchema = z
  .object({
    schemaVersion: z.number(),
    exportedAt: z.string(),
    merchant: z.object({ name: z.string() }),
    customer: z.object({
      id: z.string(),
      firstName: nullableString,
      phone: nullableString,
      preferredLanguage: z.string(),
      status: z.string(),
      createdAt: z.string().nullable(),
      anonymizedAt: nullableString,
    }),
    consents: z.array(
      z.object({
        type: z.string(),
        action: z.string(),
        version: z.string(),
        source: z.string(),
        occurredAt: z.string().nullable(),
      }),
    ),
    memberships: z.array(
      z.object({
        id: z.string(),
        status: z.string(),
        joinedAt: z.string().nullable(),
        deactivatedAt: nullableString,
        program: z.object({ nameEn: z.string(), nameAm: nullableString }),
        walletPasses: z.array(
          z.object({ provider: z.string(), status: z.string(), createdAt: z.string().nullable() }),
        ),
        stamps: z.array(
          z.object({
            id: z.string(),
            occurredAt: z.string().nullable(),
            branchName: z.string(),
            reversed: z.boolean(),
          }),
        ),
        redemptions: z.array(
          z.object({
            id: z.string(),
            occurredAt: z.string().nullable(),
            branchName: z.string(),
            reversed: z.boolean(),
          }),
        ),
        reversals: z.array(
          z.object({
            occurredAt: z.string().nullable(),
            targetType: z.string(),
            reason: z.string(),
          }),
        ),
        rewardUnlocks: z.array(
          z.object({ unlockedAt: z.string().nullable(), expiresAt: nullableString }),
        ),
        truncated: z.boolean().optional(),
      }),
    ),
  })
  .passthrough();
export type CustomerData = z.infer<typeof customerDataSchema>;

export const reissuedCardSchema = z.object({ token: z.string() });
export const invalidatedPassesSchema = z.object({ invalidated: z.number() });

// ───────────────────────── Campaigns (PROPOSED: not in the backend OpenAPI document) ─────────────────────────
// The backend has no campaign operations yet. These shapes are a proposal for what it should offer, built and tested
// against the mock backend only. The screen says so, and in a production build (no mock) every call is refused with
// a 404, which the screen shows as "not available yet".

export const CAMPAIGN_AUDIENCES = ["ALL_OPTED_IN", "INACTIVE_30_DAYS", "NEAR_REWARD"] as const;
export const CAMPAIGN_STATUSES = ["DRAFT", "SENT", "CANCELLED"] as const;

export const campaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  messageEn: z.string(),
  messageAm: nullableString,
  /** Only customers who agreed to marketing are ever included, whichever audience is chosen. */
  audience: z.enum(CAMPAIGN_AUDIENCES),
  audienceSize: z.number(),
  status: z.enum(CAMPAIGN_STATUSES),
  createdAt: z.string(),
  sentAt: nullableString,
  replayed: z.boolean().optional(),
});
export type Campaign = z.infer<typeof campaignSchema>;

export const campaignPageSchema = z.object({
  items: z.array(campaignSchema),
  nextCursor: z.string().nullable(),
});
export type CampaignPage = z.infer<typeof campaignPageSchema>;
