"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "./config";
import { createFormatter, type Formatter } from "./format";
import { en } from "./messages/en";
import { createTranslator, type Translate } from "./translator";

interface I18nValue {
  locale: Locale;
  t: Translate;
  format: Formatter;
}

const I18nContext = createContext<I18nValue | null>(null);

/** Gives Client Components the active language and the namespaces the server chose to send. */
export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Record<string, unknown>;
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      format: createFormatter(locale),
      t: createTranslator({
        messages,
        fallback: en,
        onMissing:
          process.env.NODE_ENV === "development"
            ? (key) => console.warn(`[i18n] Missing "${locale}" translation for "${key}"`)
            : undefined,
      }),
    }),
    [locale, messages],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}

export function useT(): Translate {
  return useI18n().t;
}

/** Dates, numbers and phone numbers in the active language. */
export function useFormat(): Formatter {
  return useI18n().format;
}
