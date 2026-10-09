import { MerchantsWorkspace } from "@/features/operations/components/merchants-workspace";
import { OpsFrame } from "@/features/operations/page-frame";
import { assertLocale } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.merchants");

export default async function MerchantsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  return (
    <OpsFrame
      locale={locale}
      path="/operations/merchants"
      titleKey="nav.merchants"
      subtitleKey="ops.merchantsSubtitle"
    >
      <MerchantsWorkspace />
    </OpsFrame>
  );
}
