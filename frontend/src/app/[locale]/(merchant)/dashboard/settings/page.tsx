import { PageHeading } from "@/components/ui";
import { SettingsForm } from "@/features/settings/components/settings-form";
import { requireRoute } from "@/lib/auth/server";
import { I18nProvider } from "@/lib/i18n/client";
import { assertLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces } from "@/lib/i18n/translator";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.settings");

export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  // The route rule already requires `merchant:update`, so everyone who gets here may edit.
  await requireRoute(locale, "/dashboard/settings");
  const t = await getTranslator(locale);
  const messages = pickNamespaces(await getMessages(locale), [
    "common",
    "errors",
    "ui",
    "nav",
    "areas",
    "settings",
  ]);
  return (
    <I18nProvider locale={locale} messages={messages}>
      <PageHeading title={t("nav.settings")} description={t("settings.subtitle")} />
      <SettingsForm canEdit />
    </I18nProvider>
  );
}
