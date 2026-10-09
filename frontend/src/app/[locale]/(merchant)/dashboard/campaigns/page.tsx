import { PageHeading } from "@/components/ui";
import { CampaignsWorkspace } from "@/features/campaigns/components/campaigns-workspace";
import { requireRoute } from "@/lib/auth/server";
import { I18nProvider } from "@/lib/i18n/client";
import { assertLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces } from "@/lib/i18n/translator";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.campaigns");

export default async function CampaignsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  await requireRoute(locale, "/dashboard/campaigns");
  const t = await getTranslator(locale);
  const messages = pickNamespaces(await getMessages(locale), [
    "common",
    "errors",
    "ui",
    "nav",
    "areas",
    "campaigns",
  ]);
  return (
    <I18nProvider locale={locale} messages={messages}>
      <PageHeading title={t("nav.campaigns")} description={t("campaigns.subtitle")} />
      <CampaignsWorkspace />
    </I18nProvider>
  );
}
