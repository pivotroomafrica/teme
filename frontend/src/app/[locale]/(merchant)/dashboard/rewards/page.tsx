import { PageHeading } from "@/components/ui";
import { RewardsWorkspace } from "@/features/records/components/rewards-workspace";
import { requireRoute } from "@/lib/auth/server";
import { I18nProvider } from "@/lib/i18n/client";
import { assertLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces } from "@/lib/i18n/translator";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.rewards");

export default async function RewardsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  const ctx = await requireRoute(locale, "/dashboard/rewards");
  const t = await getTranslator(locale);
  const messages = pickNamespaces(await getMessages(locale), [
    "common",
    "errors",
    "ui",
    "nav",
    "areas",
    "dashboard",
    "records",
    "privacy",
  ]);
  const permissions = ctx.principal.permissions;

  return (
    <I18nProvider locale={locale} messages={messages}>
      <PageHeading title={t("nav.rewards")} description={t("records.rewardsSubtitle")} />
      <RewardsWorkspace
        canManage={permissions.includes("customer:manage")}
        canReverse={permissions.includes("reversal:create")}
        canPrivacy={permissions.includes("privacy:manage")}
        canSeeAudit={permissions.includes("audit:read")}
      />
    </I18nProvider>
  );
}
