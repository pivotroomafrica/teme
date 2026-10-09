import { SystemStatus } from "@/features/operations/components/system-status";
import { loadHealth } from "@/features/operations/health";
import { OpsFrame } from "@/features/operations/page-frame";
import { assertLocale } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.system");

export default async function SystemPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  const { health, checkedAt } = await loadHealth();
  return (
    <OpsFrame
      locale={locale}
      path="/operations/system"
      titleKey="nav.system"
      subtitleKey="ops.systemSubtitle"
    >
      <SystemStatus health={health} checkedAt={checkedAt} />
    </OpsFrame>
  );
}
