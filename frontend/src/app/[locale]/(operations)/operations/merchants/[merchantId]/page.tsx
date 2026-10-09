import { notFound } from "next/navigation";
import { MerchantDetail } from "@/features/operations/components/merchant-detail";
import { OpsFrame } from "@/features/operations/page-frame";
import { assertLocale } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.merchants");

/** Merchant ids are UUIDs. Anything else is not a merchant, so it never reaches a request. */
const ID = /^[0-9a-fA-F-]{8,64}$/;

export default async function MerchantPage({
  params,
}: {
  params: Promise<{ locale: string; merchantId: string }>;
}) {
  const { locale: rawLocale, merchantId } = await params;
  const locale = assertLocale(rawLocale);
  if (!ID.test(merchantId)) notFound();
  return (
    <OpsFrame
      locale={locale}
      path={`/operations/merchants/${merchantId}`}
      titleKey="nav.merchants"
      subtitleKey="ops.merchantsSubtitle"
    >
      <MerchantDetail merchantId={merchantId} />
    </OpsFrame>
  );
}
