import type { ReactNode } from "react";
import { PageHeading } from "@/components/ui";
import { requireRoute } from "@/lib/auth/server";
import { I18nProvider } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import { getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces, type MessageKey } from "@/lib/i18n/translator";

/**
 * The shared frame of every operations page: the route's own access check first (platform account, explicit
 * permission, otherwise the person is turned away), then the page's words, then the heading. Nothing is rendered
 * or fetched for someone who fails the check.
 */
export async function OpsFrame({
  locale,
  path,
  titleKey,
  subtitleKey,
  children,
}: {
  locale: Locale;
  /** Route without the language prefix, e.g. "/operations/merchants". */
  path: string;
  titleKey: MessageKey;
  subtitleKey: MessageKey;
  children: ReactNode;
}) {
  await requireRoute(locale, path);
  const t = await getTranslator(locale);
  const messages = pickNamespaces(await getMessages(locale), [
    "common",
    "errors",
    "ui",
    "nav",
    "areas",
    "dashboard",
    "records",
    "ops",
  ]);
  return (
    <I18nProvider locale={locale} messages={messages}>
      <PageHeading title={t(titleKey)} description={t(subtitleKey)} />
      {children}
    </I18nProvider>
  );
}
