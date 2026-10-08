import { redirect } from "next/navigation";
import { PageHeading } from "@/components/ui";
import { ScannerApp } from "@/features/scanner/components/scanner-app";
import { loadBranches, requireRoute } from "@/lib/auth/server";
import { I18nProvider } from "@/lib/i18n/client";
import { assertLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces } from "@/lib/i18n/translator";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "areas.staff");

export default async function ScannerPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  await requireRoute(locale, "/staff/scanner");
  const t = await getTranslator(locale);

  // The scanner always works at one known branch: remembered, or the only one, or the person chooses.
  const { current } = await loadBranches();
  if (!current) redirect(`/${locale}/staff/branch`);

  const messages = pickNamespaces(await getMessages(locale), [
    "common",
    "errors",
    "ui",
    "nav",
    "auth",
    "areas",
    "enrollment",
    "scanner",
    "confirm",
  ]);

  return (
    <I18nProvider locale={locale} messages={messages}>
      <PageHeading title={t("areas.staff")} />
      <ScannerApp
        branchId={current.id}
        branchName={locale === "am" && current.nameAm ? current.nameAm : current.nameEn}
      />
    </I18nProvider>
  );
}
