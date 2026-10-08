import "server-only";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "./config";
import { createFormatter, type Formatter } from "./format";
import { en, type Messages } from "./messages/en";
import { createTranslator, type Translate } from "./translator";

const dictionaries: Record<Locale, () => Promise<Messages>> = {
  en: async () => en,
  am: () => import("./messages/am").then((m) => m.am),
};

/** Validates the [locale] route segment; unknown languages are a 404. */
export function assertLocale(value: string): Locale {
  if (!isLocale(value)) notFound();
  return value;
}

export async function getMessages(locale: Locale): Promise<Messages> {
  return dictionaries[locale]();
}

/** Translate function for Server Components. */
export async function getTranslator(locale: Locale): Promise<Translate> {
  const messages = await getMessages(locale);
  return createTranslator({
    messages,
    fallback: en,
    onMissing:
      process.env.NODE_ENV === "development"
        ? (key) => console.warn(`[i18n] Missing "${locale}" translation for "${key}"`)
        : undefined,
  });
}

/** Date, number and phone formatting for Server Components. */
export function getFormatter(locale: Locale): Formatter {
  return createFormatter(locale);
}
