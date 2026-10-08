export const locales = ["en", "am"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

/** Cookie that remembers the visitor's language choice (a preference, not a credential). */
export const LOCALE_COOKIE = "tc_locale";

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "en" || value === "am";
}

/** BCP 47 tags used for Intl formatting and <html lang>. Amharic is written left to right. */
export const localeTags: Record<Locale, string> = { en: "en-ET", am: "am-ET" };
export const localeNames: Record<Locale, string> = { en: "English", am: "አማርኛ" };
