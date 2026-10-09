import { PageHeading } from "@/components/ui";
import { RetentionPanel } from "@/features/privacy/components/retention-panel";
import { requireRoute } from "@/lib/auth/server";
import { I18nProvider } from "@/lib/i18n/client";
import { assertLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces } from "@/lib/i18n/translator";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.privacyData");

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  await requireRoute(locale, "/dashboard/privacy");
  const t = await getTranslator(locale);
  const messages = pickNamespaces(await getMessages(locale), [
    "common",
    "errors",
    "ui",
    "nav",
    "areas",
    "privacy",
  ]);
  return (
    <I18nProvider locale={locale} messages={messages}>
      <PageHeading title={t("nav.privacyData")} description={t("privacy.subtitle")} />
      <RetentionPanel />
    </I18nProvider>
  );
}
