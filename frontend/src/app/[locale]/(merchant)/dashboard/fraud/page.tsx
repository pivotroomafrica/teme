import { PageHeading } from "@/components/ui";
import { FraudWorkspace } from "@/features/fraud/components/fraud-workspace";
import { requireRoute } from "@/lib/auth/server";
import { I18nProvider } from "@/lib/i18n/client";
import { assertLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces } from "@/lib/i18n/translator";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.fraud");

export default async function FraudPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  const ctx = await requireRoute(locale, "/dashboard/fraud");
  const t = await getTranslator(locale);
  const messages = pickNamespaces(await getMessages(locale), [
    "common",
    "errors",
    "ui",
    "nav",
    "areas",
    "fraud",
  ]);
  return (
    <I18nProvider locale={locale} messages={messages}>
      <PageHeading title={t("nav.fraud")} description={t("fraud.subtitle")} />
      <FraudWorkspace canManage={ctx.principal.permissions.includes("fraud:manage")} />
    </I18nProvider>
  );
}
