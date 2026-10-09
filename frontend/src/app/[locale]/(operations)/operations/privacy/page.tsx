import { PrivacyView } from "@/features/operations/components/privacy-view";
import { OpsFrame } from "@/features/operations/page-frame";
import { assertLocale } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.privacy");

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  return (
    <OpsFrame
      locale={locale}
      path="/operations/privacy"
      titleKey="nav.privacy"
      subtitleKey="ops.privacySubtitle"
    >
      <PrivacyView />
    </OpsFrame>
  );
}
