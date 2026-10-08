import type { Locale } from "@/lib/i18n/config";

/**
 * Merchant-written text is shown exactly as the business wrote it, never machine-translated. When the
 * business wrote the page's language that version is used; otherwise the English original is shown and
 * marked with its own language so screen readers and fonts treat it correctly.
 */
export function pickLocalized(
  locale: Locale,
  english: string,
  amharic: string | null | undefined,
): { text: string; lang: Locale } {
  if (locale === "am" && amharic && amharic.trim()) return { text: amharic, lang: "am" };
  return { text: english, lang: "en" };
}

/** Brand colours come from the business; only a plain #RRGGBB value is ever put into a style. */
export function safeBrandColor(value: string | null | undefined, fallback = "#1b5e3a"): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

/** Black or white, whichever reads better on the colour (WCAG relative luminance). */
export function readableOn(hex: string): "#ffffff" | "#1a1a1a" {
  const channel = (start: number) => {
    const c = parseInt(hex.slice(start, start + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.4 ? "#1a1a1a" : "#ffffff";
}

/** First letter of the business name, for the logo placeholder (the API has no logo field yet). */
export function monogram(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "•";
}
