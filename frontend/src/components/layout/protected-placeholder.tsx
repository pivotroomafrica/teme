import { requireRoute } from "@/lib/auth/server";
import type { Locale } from "@/lib/i18n/config";
import type { MessageKey } from "@/lib/i18n/translator";
import { PlaceholderPage } from "./placeholder-page";

/**
 * A signed-in page whose real screen arrives in a later step. It already performs the page-level access
 * check for its route (exact permission from lib/auth/permissions), so the route is protected from day one.
 */
export async function ProtectedPlaceholder({
  locale,
  path,
  titleKey,
}: {
  locale: Locale;
  /** Route without the language prefix, e.g. "/dashboard/analytics". */
  path: string;
  titleKey: MessageKey;
}) {
  await requireRoute(locale, path);
  return <PlaceholderPage locale={locale} titleKey={titleKey} />;
}
