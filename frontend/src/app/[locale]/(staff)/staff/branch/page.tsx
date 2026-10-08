import { Alert, PageHeading } from "@/components/ui";
import { BranchPicker } from "@/features/scanner/components/branch-picker";
import { loadBranches, requireRoute } from "@/lib/auth/server";
import { assertLocale, getTranslator } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "auth.chooseBranchTitle");

export default async function BranchPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  await requireRoute(locale, "/staff/branch");
  const t = await getTranslator(locale);
  const { branches, current } = await loadBranches();
  const active = branches.filter((b) => b.status === "ACTIVE");

  return (
    <>
      <PageHeading title={t("auth.chooseBranchTitle")} description={t("auth.chooseBranchBody")} />
      {active.length === 0 ? (
        <Alert tone="warning">{t("auth.chooseBranchNone")}</Alert>
      ) : (
        <BranchPicker branches={active} currentId={current?.id} />
      )}
    </>
  );
}
