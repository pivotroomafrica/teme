import type { MerchantProfile } from "@/lib/api/contract";
import type { ProfilePatch } from "@/features/merchant/api";

/** What the form holds: every field as text, so empty means "none" for the optional ones. */
export interface SettingsValues {
  nameEn: string;
  nameAm: string;
  defaultLanguage: "EN" | "AM";
  timezone: string;
  supportEmail: string;
  supportPhone: string;
  defaultStampsRequired: string;
  defaultCooldownMinutes: string;
}

export const TIMEZONES = [
  "Africa/Addis_Ababa",
  "Africa/Nairobi",
  "Africa/Djibouti",
  "Africa/Mogadishu",
  "Africa/Cairo",
  "UTC",
] as const;

export function valuesFrom(profile: MerchantProfile): SettingsValues {
  return {
    nameEn: profile.nameEn,
    nameAm: profile.nameAm ?? "",
    defaultLanguage: profile.defaultLanguage ?? "EN",
    timezone: profile.timezone,
    supportEmail: profile.supportEmail ?? "",
    supportPhone: profile.supportPhone ?? "",
    defaultStampsRequired: String(profile.programDefaults?.stampsRequired ?? 8),
    defaultCooldownMinutes: String(profile.programDefaults?.cooldownMinutes ?? 60),
  };
}

/**
 * Only what changed, in the shape the backend's partial update expects: an emptied optional field is sent as `null`
 * (clear it), anything untouched is left out, so a save can never overwrite a field someone else changed meanwhile.
 */
export function patchFrom(before: SettingsValues, after: SettingsValues): ProfilePatch {
  const patch: ProfilePatch = {};
  if (after.nameEn.trim() !== before.nameEn.trim()) patch.nameEn = after.nameEn.trim();
  if (after.nameAm.trim() !== before.nameAm.trim()) patch.nameAm = after.nameAm.trim() || null;
  if (after.defaultLanguage !== before.defaultLanguage)
    patch.defaultLanguage = after.defaultLanguage;
  if (after.timezone !== before.timezone) patch.timezone = after.timezone;
  if (after.supportEmail.trim() !== before.supportEmail.trim()) {
    patch.supportEmail = after.supportEmail.trim() || null;
  }
  if (after.supportPhone.trim() !== before.supportPhone.trim()) {
    patch.supportPhone = after.supportPhone.trim() || null;
  }
  if (after.defaultStampsRequired !== before.defaultStampsRequired) {
    patch.defaultStampsRequired = Number(after.defaultStampsRequired);
  }
  if (after.defaultCooldownMinutes !== before.defaultCooldownMinutes) {
    patch.defaultCooldownMinutes = Number(after.defaultCooldownMinutes);
  }
  return patch;
}
