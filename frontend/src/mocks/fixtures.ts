/**
 * Typed development fixtures. Everything here is made-up sample data (no real people or businesses) and is
 * only ever reachable in mock mode. Shapes come from lib/api/contract, so a fixture that stops matching the
 * contract fails the type check and the contract tests.
 */
import type {
  JoinInfo,
  Me,
  RejectionReason,
  ScanResult,
  Session,
  WebCard,
} from "@/lib/api/contract";
import type { Branch } from "@/features/branches/api";

export const MOCK_PASSWORD = "mock-password-1";
export const MOCK_CONSENT_VERSION = "2026-10-v1";
export const MOCK_MERCHANT_ID = "00000000-0000-4000-8000-00000000a001";
export const MOCK_BRANCHES: Branch[] = [
  {
    id: "00000000-0000-4000-8000-0000000b0001",
    nameEn: "Bole",
    nameAm: "ቦሌ",
    addressText: "Bole Road",
    city: "Addis Ababa",
    phoneE164: null,
    status: "ACTIVE",
  },
  {
    id: "00000000-0000-4000-8000-0000000b0002",
    nameEn: "Piassa",
    nameAm: "ፒያሳ",
    addressText: "Churchill Avenue",
    city: "Addis Ababa",
    phoneE164: null,
    status: "ACTIVE",
  },
];

const MERCHANT_PERMISSIONS = [
  "merchant:read",
  "merchant:update",
  "branch:read",
  "branch:manage",
  "staff:read",
  "staff:manage",
  "program:read",
  "program:manage",
  "customer:read",
  "customer:manage",
  "stamp:create",
  "redemption:create",
  "reversal:create",
  "audit:read",
  "analytics:read",
  "privacy:manage",
  "fraud:read",
  "fraud:manage",
];

/** Sign in with these emails and MOCK_PASSWORD. */
export const MOCK_ACCOUNTS = {
  "owner@mock.test": {
    id: "00000000-0000-4000-8000-0000000c0001",
    displayName: "Hana Owner",
    role: "OWNER",
    kind: "merchant" as const,
    permissions: MERCHANT_PERMISSIONS,
    branchScope: "ALL" as Me["branchScope"],
  },
  "manager@mock.test": {
    id: "00000000-0000-4000-8000-0000000c0002",
    displayName: "Dawit Manager",
    role: "MANAGER",
    kind: "merchant" as const,
    permissions: MERCHANT_PERMISSIONS.filter((p) => p !== "privacy:manage" && p !== "fraud:manage"),
    branchScope: "ALL" as Me["branchScope"],
  },
  // Can look at programs and statistics but not change anything (test account for read-only screens).
  "viewer@mock.test": {
    id: "00000000-0000-4000-8000-0000000c0005",
    displayName: "Rahel Reader",
    role: "MANAGER",
    kind: "merchant" as const,
    permissions: MERCHANT_PERMISSIONS.filter(
      (p) => !p.endsWith(":manage") && p !== "merchant:update" && p !== "reversal:create",
    ),
    branchScope: "ALL" as Me["branchScope"],
  },
  "staff@mock.test": {
    id: "00000000-0000-4000-8000-0000000c0003",
    displayName: "Selam Cashier",
    role: "STAFF",
    kind: "merchant" as const,
    permissions: [
      "branch:read",
      "program:read",
      "customer:read",
      "stamp:create",
      "redemption:create",
    ],
    branchScope: MOCK_BRANCHES.map((b) => b.id) as Me["branchScope"],
  },
  "admin@mock.test": {
    id: "00000000-0000-4000-8000-0000000c0004",
    displayName: "Operations Admin",
    role: "PLATFORM_ADMIN",
    kind: "platform" as const,
    permissions: ["platform:manage", "platform:audit:read"],
    branchScope: null as Me["branchScope"],
  },
} as const;
export type MockEmail = keyof typeof MOCK_ACCOUNTS;

export const accessTokenFor = (email: MockEmail) => `mock-access.${email}`;
export const refreshTokenFor = (email: MockEmail, n = 1) => `mock-refresh.${email}.${n}`;

export function sessionFor(email: MockEmail, refreshCounter = 1): Session {
  const account = MOCK_ACCOUNTS[email];
  return {
    accessToken: accessTokenFor(email),
    refreshToken: refreshTokenFor(email, refreshCounter),
    tokenType: "Bearer",
    expiresIn: 900,
    user: {
      id: account.id,
      displayName: account.displayName,
      accountType: account.kind === "platform" ? "PLATFORM_ADMIN" : "MERCHANT_USER",
      role: account.role,
      merchantId: account.kind === "platform" ? null : MOCK_MERCHANT_ID,
    },
  };
}

export function meFor(email: MockEmail): Me {
  const account = MOCK_ACCOUNTS[email];
  return {
    userId: account.id,
    kind: account.kind,
    role: account.role,
    merchantId: account.kind === "platform" ? null : MOCK_MERCHANT_ID,
    permissions: [...account.permissions],
    branchScope: account.branchScope,
  };
}

export const MOCK_JOIN_INFO: JoinInfo = {
  merchant: { nameEn: "Sample Cafe", nameAm: "ናሙና ቡና ቤት", defaultLanguage: "AM" },
  program: {
    nameEn: "Coffee Card",
    nameAm: "የቡና ካርድ",
    stampsRequired: 8,
    brandColor: "#1B5E3A",
    cardDisplay: {},
    termsEn: "One stamp per visit. The 8th stamp earns a free coffee.",
    termsAm: "በአንድ ጉብኝት አንድ ስታምፕ። 8ኛው ስታምፕ ነጻ ቡና ያስገኛል።",
    reward: {
      nameEn: "Free coffee",
      nameAm: "ነጻ ቡና",
      descriptionEn: "Any coffee from the menu.",
      descriptionAm: "ከዝርዝሩ ማንኛውም ቡና።",
    },
  },
  consent: { version: MOCK_CONSENT_VERSION },
  wallet: [
    { provider: "WEB", available: true, reason: null, addUrl: null },
    { provider: "APPLE", available: false, reason: "NOT_CONFIGURED", addUrl: null },
    { provider: "GOOGLE", available: false, reason: "NOT_CONFIGURED", addUrl: null },
  ],
};

export function webCardFor(
  token: string,
  state: {
    stamps: number;
    rewardsAvailable: number;
    status?: WebCard["status"];
    firstName?: string;
  },
): WebCard {
  const required = MOCK_JOIN_INFO.program.stampsRequired;
  return {
    merchant: { nameEn: MOCK_JOIN_INFO.merchant.nameEn, nameAm: MOCK_JOIN_INFO.merchant.nameAm },
    program: {
      nameEn: MOCK_JOIN_INFO.program.nameEn,
      nameAm: MOCK_JOIN_INFO.program.nameAm,
      brandColor: MOCK_JOIN_INFO.program.brandColor,
      termsEn: MOCK_JOIN_INFO.program.termsEn ?? "",
      termsAm: MOCK_JOIN_INFO.program.termsAm,
    },
    customer: { firstName: state.firstName ?? "Abebe", preferredLanguage: "AM" },
    progress: {
      current: state.stamps % required,
      required,
      remaining: required - (state.stamps % required),
      completedCards: Math.floor(state.stamps / required),
    },
    rewardsAvailable: state.rewardsAvailable,
    // Like the real backend: the program reward is always shown, whether or not one is waiting.
    reward: {
      nameEn: "Free coffee",
      nameAm: "ነጻ ቡና",
      descriptionEn: "Any coffee from the menu.",
      descriptionAm: "ከዝርዝሩ ማንኛውም ቡና።",
    },
    status: state.status ?? "ACTIVE",
    barcode: token,
    version: 1,
  };
}

export const REJECTION_MESSAGES: Record<RejectionReason, ScanResult["message"]> = {
  BRANCH_NOT_PERMITTED: {
    en: "You cannot scan at this branch.",
    am: "በዚህ ቅርንጫፍ መቃኘት አይችሉም።",
  },
  INVALID_TOKEN: { en: "This card is not valid here.", am: "ይህ ካርድ እዚህ ተቀባይነት የለውም።" },
  MEMBERSHIP_INACTIVE: { en: "This membership is not active.", am: "ይህ አባልነት ንቁ አይደለም።" },
  PROGRAM_INACTIVE: { en: "This program is not active.", am: "ይህ ፕሮግራም ንቁ አይደለም።" },
  COOLDOWN_ACTIVE: {
    en: "A stamp was just added. Please wait.",
    am: "ስታምፕ አሁን ተጨምሯል። እባክዎ ይጠብቁ።",
  },
  NO_REWARD_AVAILABLE: { en: "No reward is available.", am: "ምንም ሽልማት የለም።" },
  REWARD_NOT_AVAILABLE: { en: "That reward is not available.", am: "ያ ሽልማት አይገኝም።" },
};

/** Members the customer search can find (9-digit national numbers). */
export const MOCK_CUSTOMERS = [
  {
    id: "00000000-0000-4000-8000-0000000e0001",
    firstName: "Abebe",
    phone: "911000111",
    active: true,
  },
  {
    id: "00000000-0000-4000-8000-0000000e0002",
    firstName: "Tigist",
    phone: "922000222",
    active: false,
  },
];
