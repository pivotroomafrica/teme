import { PageHeading } from "@/components/ui";
import { BranchesWorkspace } from "@/features/branches/components/branches-workspace";
import { requireRoute } from "@/lib/auth/server";
import { I18nProvider } from "@/lib/i18n/client";
import { assertLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces } from "@/lib/i18n/translator";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.branches");

export default async function BranchesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  const ctx = await requireRoute(locale, "/dashboard/branches");
  const t = await getTranslator(locale);
  const can = (permission: string) => ctx.principal.permissions.includes(permission);

  const messages = pickNamespaces(await getMessages(locale), [
    "common",
    "errors",
    "ui",
    "nav",
    "auth",
    "areas",
    "branches",
    "team",
  ]);

  return (
    <I18nProvider locale={locale} messages={messages}>
      <PageHeading title={t("nav.branches")} description={t("branches.subtitle")} />
      <BranchesWorkspace canManage={can("branch:manage")} canReadStaff={can("staff:read")} />
    </I18nProvider>
  );
}
