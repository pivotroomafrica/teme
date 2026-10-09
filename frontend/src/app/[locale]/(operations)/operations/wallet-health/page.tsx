import { WalletHealth } from "@/features/operations/components/wallet-health";
import { OpsFrame } from "@/features/operations/page-frame";
import { assertLocale } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.walletHealth");

export default async function WalletHealthPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = assertLocale((await params).locale);
  return (
    <OpsFrame
      locale={locale}
      path="/operations/wallet-health"
      titleKey="nav.walletHealth"
      subtitleKey="ops.walletSubtitle"
    >
      <WalletHealth />
    </OpsFrame>
  );
}
