import { PageHeading } from "@/components/ui";
import { TeamWorkspace } from "@/features/team/components/team-workspace";
import { requireRoute } from "@/lib/auth/server";
import { I18nProvider } from "@/lib/i18n/client";
import { assertLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces } from "@/lib/i18n/translator";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.team");

export default async function TeamPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  const ctx = await requireRoute(locale, "/dashboard/team");
  const t = await getTranslator(locale);

  const messages = pickNamespaces(await getMessages(locale), [
    "common",
    "errors",
    "ui",
    "nav",
    "auth",
    "areas",
    "team",
    "branches",
    "dashboard",
    "program",
  ]);

  return (
    <I18nProvider locale={locale} messages={messages}>
      <PageHeading title={t("nav.team")} description={t("team.subtitle")} />
      <TeamWorkspace
        actor={{ userId: ctx.me.userId, role: ctx.me.role }}
        canManage={ctx.principal.permissions.includes("staff:manage")}
      />
    </I18nProvider>
  );
}
