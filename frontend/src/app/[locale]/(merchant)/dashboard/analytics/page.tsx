import { PageHeading } from "@/components/ui";
import { AnalyticsWorkspace } from "@/features/analytics/components/analytics-workspace";
import { todayIn } from "@/features/dashboard/range";
import { pickLocalized } from "@/features/enrollment/localized";
import { getServerApi } from "@/lib/api/server";
import { requireRoute } from "@/lib/auth/server";
import { I18nProvider } from "@/lib/i18n/client";
import { assertLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces } from "@/lib/i18n/translator";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.analytics");

const DEFAULT_ZONE = "Africa/Addis_Ababa";

export default async function AnalyticsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  const ctx = await requireRoute(locale, "/dashboard/analytics");
  const t = await getTranslator(locale);

  // Dates and months follow the business time zone. If the profile cannot be read, the page still works in the
  // default zone rather than failing as a whole.
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
    "areas",
    "dashboard",
    "analytics",
  ]);

  return (
    <I18nProvider locale={locale} messages={messages}>
      <PageHeading
        title={t("nav.analytics")}
        eyebrow={business?.text}
        description={t("analytics.subtitle")}
      />
      <AnalyticsWorkspace
        timeZone={timeZone}
        today={todayIn(timeZone)}
        canReadAnalytics={ctx.principal.permissions.includes("analytics:read")}
      />
    </I18nProvider>
  );
}
