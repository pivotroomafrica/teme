import { OpsOverview } from "@/features/operations/components/ops-overview";
import { loadHealth } from "@/features/operations/health";
import { OpsFrame } from "@/features/operations/page-frame";
import { assertLocale } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.overview");

export default async function OperationsHome({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  const { health } = await loadHealth();
  return (
    <OpsFrame
      locale={locale}
      path="/operations"
      titleKey="nav.overview"
      subtitleKey="ops.overviewSubtitle"
    >
      <OpsOverview health={health} />
    </OpsFrame>
  );
}
