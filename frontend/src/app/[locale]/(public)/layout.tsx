import type { ReactNode } from "react";
import { PublicShell } from "@/components/layout/shells";
import { assertLocale } from "@/lib/i18n/server";

export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = assertLocale((await params).locale);
  return <PublicShell locale={locale}>{children}</PublicShell>;
}
