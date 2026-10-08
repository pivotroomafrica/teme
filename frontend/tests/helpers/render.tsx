import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";

/** Renders a component the way the app does: with the active language and the toast host. */
export function renderUi(ui: ReactElement, locale: Locale = "en"): RenderResult {
  const messages = locale === "am" ? am : en;
  const wrap = (node: ReactNode) => (
    <I18nProvider locale={locale} messages={messages}>
      <ToastProvider>{node}</ToastProvider>
    </I18nProvider>
  );
  const result = render(wrap(ui));
  return {
    ...result,
    rerender: (next: ReactNode) => result.rerender(wrap(next)),
  };
}
