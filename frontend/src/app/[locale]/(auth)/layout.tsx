import type { ReactNode } from "react";
import { AuthShell } from "@/components/layout/shells";
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
  return <AuthShell locale={locale}>{children}</AuthShell>;
}
