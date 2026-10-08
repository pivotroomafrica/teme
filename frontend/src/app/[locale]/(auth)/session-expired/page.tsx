import { ButtonLink } from "@/components/ui";
import { assertLocale, getTranslator } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translator";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "auth.sessionEndedTitle");

const REASONS: Record<string, { title: MessageKey; body: MessageKey }> = {
  expired: { title: "auth.sessionEndedTitle", body: "auth.sessionEndedBody" },
  unavailable: { title: "auth.sessionEndedTitle", body: "errors.unavailable" },
  revoked: { title: "auth.revokedTitle", body: "auth.revokedBody" },
  deactivated: { title: "auth.deactivatedTitle", body: "auth.deactivatedBody" },
  "signed-out": { title: "auth.signedOutTitle", body: "auth.signedOutBody" },
};

/**
 * Explains why a session is over. The cookie was already cleared by the endpoint that sent the person here;
 * this page only shows the reason (an unknown value falls back to the generic "session ended").
 */
export default async function SessionEndedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  const locale = assertLocale((await params).locale);
  const t = await getTranslator(locale);
  const { reason } = await searchParams;
  const text = REASONS[typeof reason === "string" ? reason : ""] ?? REASONS.expired!;

  return (
    <section aria-labelledby="ended-title" className="text-center">
      <h1 id="ended-title" className="text-2xl font-bold text-green-900">
        {t(text.title)}
      </h1>
      <p role="status" className="mt-3 text-charcoal-700">
        {t(text.body)}
      </p>
      <div className="mt-6">
        <ButtonLink href={`/${locale}/login`} size="lg" fullWidth>
          {t("auth.signInAgain")}
        </ButtonLink>
      </div>
    </section>
  );
}
