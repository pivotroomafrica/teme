import type { MerchantProfile } from "@/lib/api/contract";
import { normalizeEthiopianPhone } from "@/lib/i18n/phone";
import { MOCK_JOIN_INFO } from "./fixtures";

/**
 * Mock business profile, with the backend's validation (backend/src/modules/merchants): a partial update where only
 * the fields sent change and `null` clears an optional one; English name 1-120 characters; a real IANA time zone;
 * support e-mail and an Ethiopian phone number (stored as +251...); default stamps 1-1000 and cooldown 0-10080
 * minutes. Every mock account has its own copy.
 */
export type Reply = { status: number; body: unknown };
export type ProfileStore = Map<string, MerchantProfile>;

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

export function profileFor(store: ProfileStore, email: string): MerchantProfile {
  let profile = store.get(email);
  if (!profile) {
    profile = {
      nameEn: MOCK_JOIN_INFO.merchant.nameEn,
      nameAm: MOCK_JOIN_INFO.merchant.nameAm,
      timezone: "Africa/Addis_Ababa",
      joinReference: "sample-cafe",
      slug: "sample-cafe",
      status: "ACTIVE",
      defaultLanguage: "AM",
      supportEmail: "hello@sample-cafe.example",
      supportPhone: "+251911000000",
      logo: null,
      programDefaults: { stampsRequired: 8, cooldownMinutes: 60 },
    };
    store.set(email, profile);
  }
  return profile;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function validTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone.length > 0 && zone.length <= 64;
  } catch {
    return false;
  }
}

export function updateProfile(profile: MerchantProfile, body: unknown): Reply {
  if (!isRecord(body)) {
    return err(400, "VALIDATION_FAILED", "Request validation failed.", ["body must be an object"]);
  }
  const problems: string[] = [];
  const next: MerchantProfile = { ...profile, programDefaults: { ...profile.programDefaults! } };

  if ("nameEn" in body) {
    const v = body.nameEn;
    if (typeof v !== "string" || v.trim().length < 1 || v.length > 120) {
      problems.push("nameEn must be between 1 and 120 characters");
    } else next.nameEn = v.trim();
  }
  if ("nameAm" in body) {
    const v = body.nameAm;
    if (v === null) next.nameAm = null;
    else if (typeof v !== "string" || v.length > 120)
      problems.push("nameAm must be at most 120 characters");
    else next.nameAm = v.trim() || null;
  }
  if ("timezone" in body) {
    if (typeof body.timezone !== "string" || !validTimezone(body.timezone)) {
      problems.push("timezone must be a valid IANA time zone");
    } else next.timezone = body.timezone;
  }
  if ("defaultLanguage" in body) {
    if (body.defaultLanguage !== "EN" && body.defaultLanguage !== "AM") {
      problems.push("defaultLanguage must be one of the following values: EN, AM");
    } else next.defaultLanguage = body.defaultLanguage;
  }
  if ("supportEmail" in body) {
    const v = body.supportEmail;
    if (v === null) next.supportEmail = null;
    else if (typeof v !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 254) {
      problems.push("supportEmail must be an email");
    } else next.supportEmail = v.trim().toLowerCase();
  }
  if ("supportPhone" in body) {
    const v = body.supportPhone;
    if (v === null) next.supportPhone = null;
    else {
      const phone = typeof v === "string" ? normalizeEthiopianPhone(v) : null;
      if (!phone) problems.push("supportPhone must be a valid Ethiopian phone number");
      else next.supportPhone = phone;
    }
  }
  if ("defaultStampsRequired" in body) {
    const v = body.defaultStampsRequired;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 1000) {
      problems.push("defaultStampsRequired must be between 1 and 1000");
    } else next.programDefaults!.stampsRequired = v;
  }
  if ("defaultCooldownMinutes" in body) {
    const v = body.defaultCooldownMinutes;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 10_080) {
      problems.push("defaultCooldownMinutes must be between 0 and 10080");
    } else next.programDefaults!.cooldownMinutes = v;
  }
  if (problems.length) return err(400, "VALIDATION_FAILED", "Request validation failed.", problems);

  Object.assign(profile, next);
  return { status: 200, body: profile };
}
