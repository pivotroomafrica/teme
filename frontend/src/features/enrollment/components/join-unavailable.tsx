import { ButtonLink } from "@/components/ui";
import type { Locale } from "@/lib/i18n/config";
import type { Translate } from "@/lib/i18n/translator";

/**
 * Shown for every link that cannot be joined. The backend deliberately answers an unknown link, a suspended
 * business, a paused or archived program and an expired link with the same 404, so the page does too: it
 * lists the likely reasons instead of guessing, and nothing about which one applies can be learned.
 */
export function JoinUnavailable({ locale, t }: { locale: Locale; t: Translate }) {
  return (
    <section aria-labelledby="join-title" className="flex flex-col gap-4 pt-8">
      <h1 id="join-title" className="text-2xl font-bold text-green-900">
        {t("enrollment.programUnavailableTitle")}
      </h1>
      <p className="text-lg text-charcoal-700">{t("enrollment.programUnavailableBody")}</p>
      <p className="text-charcoal-700">{t("enrollment.unavailableHint")}</p>
      <div>
        <ButtonLink href={`/${locale}`} variant="secondary">
          {t("common.goHome")}
        </ButtonLink>
      </div>
    </section>
  );
}

/** The link may be fine but the service could not answer (busy, down, offline). Retrying is safe: nothing was sent. */
export function JoinTemporaryProblem({
  locale,
  joinReference,
  message,
  t,
}: {
  locale: Locale;
  joinReference: string;
  message: string;
  t: Translate;
}) {
  return (
    <section aria-labelledby="join-title" className="flex flex-col gap-4 pt-8">
      <h1 id="join-title" className="text-2xl font-bold text-green-900">
        {t("enrollment.temporaryTitle")}
      </h1>
      <div role="alert" className="rounded-card border border-red-600/40 bg-red-50 p-4">
        {message}
      </div>
      <p className="text-charcoal-700">{t("enrollment.retryHint")}</p>
      <div className="flex flex-wrap gap-3">
        {/* A plain link: reloading the page repeats the safe read, and works before any script has loaded. */}
        <a
          href={`/${locale}/join/${encodeURIComponent(joinReference)}`}
          className="touch-target inline-flex items-center rounded-control bg-primary px-5 font-semibold text-on-primary no-underline hover:bg-primary-hover"
        >
          {t("common.retry")}
        </a>
      </div>
    </section>
  );
}
