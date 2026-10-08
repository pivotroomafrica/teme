import { getTranslator } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import type { MessageKey } from "@/lib/i18n/translator";

/** Marks a route whose real screen arrives in a later step. Keeps the route group, shell and tests honest. */
export async function PlaceholderPage({
  locale,
  titleKey,
}: {
  locale: Locale;
  titleKey: MessageKey;
}) {
  const t = await getTranslator(locale);
  return (
    <section aria-labelledby="page-title" className="py-8">
      <h1 id="page-title" className="text-2xl font-bold text-green-800 sm:text-3xl">
        {t(titleKey)}
      </h1>
      <p className="mt-3 text-muted">{t("common.comingSoon")}</p>
    </section>
  );
}
