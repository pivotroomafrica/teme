import type { Metadata } from "next";
import { assertLocale, getTranslator } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translator";

/** Page metadata in the visitor's language. Private areas also get `robots: noindex` here (and an X-Robots-Tag in the proxy). */
export async function pageMetadata(
  params: Promise<{ locale: string }>,
  titleKey: MessageKey,
  options: { index?: boolean } = {},
): Promise<Metadata> {
  const locale = assertLocale((await params).locale);
  const t = await getTranslator(locale);
  return {
    title: t(titleKey),
    ...(options.index ? {} : { robots: { index: false, follow: false } }),
  };
}
