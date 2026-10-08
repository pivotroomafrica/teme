"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { localeNames, locales, type Locale } from "@/lib/i18n/config";
import { splitLocale } from "@/lib/i18n/resolve-locale";
import { useT } from "@/lib/i18n/client";

/**
 * Plain links to the same page in the other language: works without JavaScript, and visiting the other
 * language route is what saves the preference (see src/proxy.ts).
 */
export function LanguageSwitcher({
  current,
  tone = "light",
}: {
  current: Locale;
  /** "dark" for use on the dark green / charcoal headers. */
  tone?: "light" | "dark";
}) {
  const pathname = usePathname() ?? "/";
  const t = useT();
  const { rest } = splitLocale(pathname);

  return (
    <nav aria-label={t("common.language")}>
      <ul className="flex items-center gap-1">
        {locales.map((locale) => (
          <li key={locale}>
            <Link
              href={`/${locale}${rest === "/" ? "" : rest}`}
              hrefLang={locale}
              lang={locale}
              aria-current={locale === current ? "true" : undefined}
              className={
                "touch-target inline-flex items-center justify-center rounded-lg px-3 text-sm font-medium no-underline " +
                (tone === "dark"
                  ? locale === current
                    ? "bg-gold-500 text-charcoal-900"
                    : "text-white hover:bg-white/15"
                  : locale === current
                    ? "bg-green-700 text-white"
                    : "text-charcoal-700 hover:bg-cream-200")
              }
            >
              {localeNames[locale]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
