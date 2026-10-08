import { PageHeading } from "@/components/ui";
import { OverviewDashboard } from "@/features/dashboard/components/overview-dashboard";
import { todayIn } from "@/features/dashboard/range";
import { pickLocalized } from "@/features/enrollment/localized";
import { getServerApi } from "@/lib/api/server";
import { requireRoute } from "@/lib/auth/server";
import { I18nProvider } from "@/lib/i18n/client";
import { assertLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces } from "@/lib/i18n/translator";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.overview");

const DEFAULT_ZONE = "Africa/Addis_Ababa";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  const ctx = await requireRoute(locale, "/dashboard");
  const t = await getTranslator(locale);
  const can = (permission: string) => ctx.principal.permissions.includes(permission);

  // The business name and time zone frame everything below. If the profile cannot be read, the page still works
  // in the default zone rather than failing as a whole.
  const profile = await (
    await getServerApi({ accessToken: ctx.session.accessToken })
  ).merchant
    .getProfile()
    .catch(() => null);
  const timeZone = profile?.timezone ?? DEFAULT_ZONE;
  const business = profile ? pickLocalized(locale, profile.nameEn, profile.nameAm) : null;

  const messages = pickNamespaces(await getMessages(locale), [
    "common",
    "errors",
    "ui",
    "nav",
    "auth",
    "areas",
    "dashboard",
  ]);

  return (
    <I18nProvider locale={locale} messages={messages}>
      <PageHeading
        title={t("nav.overview")}
        eyebrow={business?.text}
        description={t("dashboard.subtitle")}
      />
      <OverviewDashboard
        timeZone={timeZone}
        today={todayIn(timeZone)}
        canReadAnalytics={can("analytics:read")}
        canReadAudit={can("audit:read")}
      />
    </I18nProvider>
  );
}
