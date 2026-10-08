import { ButtonLink } from "@/components/ui";
import { homeFor } from "@/lib/auth/permissions";
import { loadAuth } from "@/lib/auth/server";
import { assertLocale, getTranslator } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "errors.forbiddenTitle");

/**
 * Shown when a signed-in person opens something their role does not include. It never says what exists
 * there. The way out is their own home page (or sign-in when there is no session).
 */
export default async function DeniedPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  const t = await getTranslator(locale);
  const state = await loadAuth();

  // `homeFor` returns "/denied" for an account with no usable permissions: do not link to this page itself.
  const home = state.status === "ok" ? homeFor(state.principal) : undefined;
  const target = home && home !== "/denied" ? `/${locale}${home}` : `/${locale}/login`;
  const label = home && home !== "/denied" ? t("auth.deniedHome") : t("auth.signInAgain");

  return (
    <section aria-labelledby="denied-title" className="text-center">
      <h1 id="denied-title" className="text-2xl font-bold text-green-900">
        {t("errors.forbiddenTitle")}
      </h1>
      <p className="mt-3 text-charcoal-700">{t("errors.forbiddenBody")}</p>
      <div className="mt-6">
        <ButtonLink href={target} size="lg" fullWidth>
          {label}
        </ButtonLink>
      </div>
    </section>
  );
}
