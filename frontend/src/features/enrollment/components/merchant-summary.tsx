import type { JoinInfo } from "@/lib/api/contract";
import type { Locale } from "@/lib/i18n/config";
import type { Translate } from "@/lib/i18n/translator";
import { monogram, pickLocalized, readableOn, safeBrandColor } from "../localized";

/**
 * Who the customer is joining and what they earn: logo, business, reward and stamps needed. Server-rendered
 * so it appears with the first byte. Business-written text is shown as written (see `pickLocalized`).
 * The API has no logo field yet, so the logo is a coloured monogram in the program's brand colour.
 */
export function MerchantSummary({
  info,
  locale,
  t,
}: {
  info: JoinInfo;
  locale: Locale;
  t: Translate;
}) {
  const business = pickLocalized(locale, info.merchant.nameEn, info.merchant.nameAm);
  const program = pickLocalized(locale, info.program.nameEn, info.program.nameAm);
  const reward = info.program.reward
    ? pickLocalized(locale, info.program.reward.nameEn, info.program.reward.nameAm)
    : null;
  const rewardNote = info.program.reward?.descriptionEn
    ? pickLocalized(locale, info.program.reward.descriptionEn, info.program.reward.descriptionAm)
    : null;
  const color = safeBrandColor(info.program.brandColor);

  return (
    <section aria-labelledby="join-title" className="pt-4">
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-3xl font-bold"
          style={{ backgroundColor: color, color: readableOn(color) }}
        >
          {monogram(business.text)}
        </span>
        <div className="min-w-0">
          <h1 id="join-title" className="text-2xl font-bold break-words text-green-900">
            {t("enrollment.welcomeTo", { business: business.text })}
          </h1>
          <p className="break-words text-muted" lang={program.lang}>
            {program.text}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-card border border-border bg-surface p-4">
        <p className="text-sm font-medium text-muted">
          {t("enrollment.collectToEarn", { count: info.program.stampsRequired })}
        </p>
        {reward ? (
          <>
            <p className="mt-1 text-xl font-bold break-words text-green-800" lang={reward.lang}>
              {reward.text}
            </p>
            {rewardNote ? (
              <p className="mt-1 break-words text-charcoal-700" lang={rewardNote.lang}>
                {rewardNote.text}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
