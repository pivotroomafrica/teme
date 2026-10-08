import type { Metadata } from "next";
import { cache } from "react";
import { EnrollmentFlow } from "@/features/enrollment/components/enrollment-flow";
import {
  JoinTemporaryProblem,
  JoinUnavailable,
} from "@/features/enrollment/components/join-unavailable";
import { MerchantSummary } from "@/features/enrollment/components/merchant-summary";
import { pickLocalized } from "@/features/enrollment/localized";
import { getServerApi } from "@/lib/api/server";
import { isApiError, toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { I18nProvider } from "@/lib/i18n/client";
import { assertLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces } from "@/lib/i18n/translator";

type Props = { params: Promise<{ locale: string; joinReference: string }> };

/** The shape of a real join reference. Anything else is not worth asking the backend about. */
const JOIN_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

const loadJoinInfo = cache(async (joinReference: string) => {
  if (!JOIN_REFERENCE.test(joinReference)) return { status: "unavailable" as const };
  try {
    const info = await (await getServerApi()).enrollment.getJoinInfo(joinReference);
    return { status: "ok" as const, info };
  } catch (e) {
    const error = toApiError(e);
    // Unknown, suspended, paused, archived and expired all arrive as the same 404 by design.
    if (isApiError(error) && error.kind === "not_found") return { status: "unavailable" as const };
    return { status: "problem" as const, error };
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: rawLocale, joinReference } = await params;
  const locale = assertLocale(rawLocale);
  const t = await getTranslator(locale);
  const loaded = await loadJoinInfo(joinReference);
  const business =
    loaded.status === "ok"
      ? pickLocalized(locale, loaded.info.merchant.nameEn, loaded.info.merchant.nameAm).text
      : null;
  return {
    title: business ? t("enrollment.welcomeTo", { business }) : t("areas.join"),
    // Join links are handed out in person; they should not be listed by search engines.
    robots: { index: false, follow: false },
  };
}

export default async function JoinPage({ params }: Props) {
  const { locale: rawLocale, joinReference } = await params;
  const locale = assertLocale(rawLocale);
  const t = await getTranslator(locale);
  const loaded = await loadJoinInfo(joinReference);

  if (loaded.status === "unavailable") return <JoinUnavailable locale={locale} t={t} />;
  if (loaded.status === "problem") {
    return (
      <JoinTemporaryProblem
        locale={locale}
        joinReference={joinReference}
        message={describeApiError(loaded.error, t).description}
        t={t}
      />
    );
  }

  const { info } = loaded;
  const terms = info.program.termsEn
    ? pickLocalized(locale, info.program.termsEn, info.program.termsAm)
    : null;
  // Only the text this journey needs is sent to the browser.
  const messages = pickNamespaces(await getMessages(locale), [
    "common",
    "errors",
    "ui",
    "nav",
    "auth",
    "areas",
    "enrollment",
    "wallet",
    "card",
  ]);

  return (
    <I18nProvider locale={locale} messages={messages}>
      <MerchantSummary info={info} locale={locale} t={t} />
      <EnrollmentFlow
        joinReference={joinReference}
        consentVersion={info.consent.version}
        terms={terms ? { text: terms.text, lang: terms.lang } : null}
      />
    </I18nProvider>
  );
}
