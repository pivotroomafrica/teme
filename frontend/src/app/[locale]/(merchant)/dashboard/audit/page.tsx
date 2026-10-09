import { PageHeading } from "@/components/ui";
import { AuditWorkspace } from "@/features/records/components/audit-workspace";
import { requireRoute } from "@/lib/auth/server";
import { I18nProvider } from "@/lib/i18n/client";
import { assertLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces } from "@/lib/i18n/translator";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.audit");

export default async function AuditPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  await requireRoute(locale, "/dashboard/audit");
  const t = await getTranslator(locale);
  const messages = pickNamespaces(await getMessages(locale), [
    "common",
    "errors",
    "ui",
    "nav",
    "areas",
    "dashboard",
    "records",
  ]);

  return (
    <I18nProvider locale={locale} messages={messages}>
      <PageHeading title={t("nav.audit")} description={t("records.auditSubtitle")} />
      <AuditWorkspace />
    </I18nProvider>
  );
}
