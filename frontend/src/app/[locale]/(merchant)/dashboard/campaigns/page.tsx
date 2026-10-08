import { ProtectedPlaceholder } from "@/components/layout/protected-placeholder";
import { assertLocale } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.campaigns");

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  return (
    <ProtectedPlaceholder locale={locale} path="/dashboard/campaigns" titleKey="nav.campaigns" />
  );
}
