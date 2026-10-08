import { defaultLocale, isLocale, type Locale } from "./config";

/** Picks the first supported language from an Accept-Language header ("am-ET,am;q=0.9,en;q=0.5"). */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | undefined {
  if (!header) return undefined;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      const weight = q ? Number(q.trim().slice(2)) : 1;
      return {
        base: tag.trim().toLowerCase().split("-")[0],
        weight: Number.isFinite(weight) ? weight : 0,
      };
    })
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  return ranked.map((x) => x.base).find(isLocale);
}

/** Saved preference first, then the browser's language, then English. */
export function resolveLocale(input: {
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(input.cookie)) return input.cookie;
  return localeFromAcceptLanguage(input.acceptLanguage) ?? defaultLocale;
}

/** Splits "/am/dashboard" into { locale: "am", rest: "/dashboard" }; locale is undefined when absent. */
export function splitLocale(pathname: string): { locale: Locale | undefined; rest: string } {
  const [, first = "", ...tail] = pathname.split("/");
  if (!isLocale(first)) return { locale: undefined, rest: pathname };
  return { locale: first, rest: `/${tail.join("/")}`.replace(/\/+$/, "") || "/" };
}
