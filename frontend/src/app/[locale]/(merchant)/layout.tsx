import type { ReactNode } from "react";
import { MerchantShell } from "@/components/layout/shells";
import { loadShellData } from "@/lib/auth/shell-data";
import { assertLocale } from "@/lib/i18n/server";

/** Everything in this group depends on who is signed in, so it is rendered per request, never at build time. */
export const dynamic = "force-dynamic";

export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = assertLocale((await params).locale);
  // Layout-level access check: the right kind of account with this area's entry permission.
  const data = await loadShellData(locale, "merchant");
  return (
    <MerchantShell locale={locale} data={data}>
      {children}
    </MerchantShell>
  );
}
