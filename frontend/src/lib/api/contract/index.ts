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
