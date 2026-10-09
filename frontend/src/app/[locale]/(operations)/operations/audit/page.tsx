import { OpsAudit } from "@/features/operations/components/ops-audit";
import { OpsFrame } from "@/features/operations/page-frame";
import { assertLocale } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.audit");

export default async function OpsAuditPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  return (
    <OpsFrame
      locale={locale}
      path="/operations/audit"
      titleKey="nav.audit"
      subtitleKey="ops.auditSubtitle"
    >
      <OpsAudit />
    </OpsFrame>
  );
}
