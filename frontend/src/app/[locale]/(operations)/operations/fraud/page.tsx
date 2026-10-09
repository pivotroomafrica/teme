import { Unavailable } from "@/features/operations/components/unavailable";
import { OpsFrame } from "@/features/operations/page-frame";
import { assertLocale } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.fraud");

/**
 * Fraud indicators exist per merchant and are reviewed by that merchant's owner. The service offers no
 * platform-wide view of suspicious activity or reversal rates, so this page says so instead of inventing one.
 */
export default async function FraudPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  return (
    <OpsFrame
      locale={locale}
      path="/operations/fraud"
      titleKey="nav.fraud"
      subtitleKey="ops.fraudSubtitle"
    >
      <Unavailable items={["ops.capFraud"]} />
    </OpsFrame>
  );
}
