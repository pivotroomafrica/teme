import { ButtonLink } from "@/components/ui";
import { StampProgress } from "@/components/ui/progress";
import {
  pickLocalized,
  readableOn,
  safeBrandColor,
  monogram,
} from "@/features/enrollment/localized";
import type { WebCard } from "@/lib/api/contract";
import type { Formatter } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { Translate } from "@/lib/i18n/translator";
import { CardActions } from "./card-actions";

interface Props {
  card: WebCard;
  /** The QR code as SVG markup generated from `card.barcode` (see `qrSvg`). */
  qr: string;
  cardId: string;
  locale: Locale;
  t: Translate;
  format: Formatter;
  /** When this data was fetched. The API has no "updated at" of its own. */
  fetchedAt: Date;
  supportUrl?: string;
}

/**
 * The customer's web card: merchant branding, who it belongs to, progress, reward, the code to scan, the
 * program terms and where to get help. There is no purchase value, price or payment information anywhere:
 * the backend has none and the card never asks for any.
 *
 * Inactive memberships (paused, no longer valid, still being prepared) say so plainly and do not show a QR
 * code, because a code that cannot earn anything only causes confusion at the counter.
 */
export function WebCardView({ card, qr, cardId, locale, t, format, fetchedAt, supportUrl }: Props) {
  const business = pickLocalized(locale, card.merchant.nameEn, card.merchant.nameAm);
  const program = pickLocalized(locale, card.program.nameEn, card.program.nameAm);
  const terms = card.program.termsEn
    ? pickLocalized(locale, card.program.termsEn, card.program.termsAm)
    : null;
  const reward = card.reward
    ? {
        name: pickLocalized(locale, card.reward.nameEn, card.reward.nameAm),
        description: pickLocalized(locale, card.reward.descriptionEn, card.reward.descriptionAm),
      }
    : null;
  const color = safeBrandColor(card.program.brandColor);
  const name = card.customer.firstName?.trim();
  const active = card.status === "ACTIVE";
  const rewardWaiting = active && card.rewardsAvailable > 0;
  const rewardText = reward ? reward.name.text : "";

  const inactive =
    card.status === "SUSPENDED"
      ? {
          title: t("card.suspendedTitle"),
          body: t("card.suspendedBody", { business: business.text }),
        }
      : card.status === "INVALIDATED"
        ? {
            title: t("card.invalidatedTitle"),
            body: t("card.invalidatedBody", { business: business.text }),
          }
        : card.status === "PENDING"
          ? { title: t("card.pendingTitle"), body: t("card.pendingBody") }
          : null;

  return (
    <article
      aria-labelledby="card-title"
      className="pt-4"
      data-testid="web-card"
      data-status={card.status}
    >
      <header
        className="rounded-t-card p-5"
        style={{ backgroundColor: color, color: readableOn(color) }}
      >
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/90 text-2xl font-bold text-charcoal-900"
          >
            {monogram(business.text)}
          </span>
          <div className="min-w-0">
            <h1 id="card-title" className="text-2xl font-bold break-words" lang={business.lang}>
              {business.text}
            </h1>
            <p className="break-words opacity-90" lang={program.lang}>
              {program.text}
            </p>
          </div>
        </div>
        <p className="mt-4 text-lg font-semibold">
          {name ? t("card.greeting", { name }) : t("card.greetingAnonymous")}
        </p>
      </header>

      <div className="flex flex-col gap-5 rounded-b-card border border-t-0 border-border bg-surface p-5">
        {inactive ? (
          <div
            role="status"
            className="rounded-card border border-gold-600 bg-gold-100 p-4"
            data-testid="card-inactive"
          >
            <p className="font-bold text-charcoal-900">{inactive.title}</p>
            <p className="mt-1 text-charcoal-900">{inactive.body}</p>
          </div>
        ) : null}

        {rewardWaiting && reward ? (
          <div
            role="status"
            className="rounded-card border-2 border-gold-600 bg-gold-100 p-4"
            data-testid="card-reward-ready"
          >
            <p className="text-lg font-bold text-charcoal-900">{t("card.rewardWaitingTitle")}</p>
            <p className="mt-1 break-words text-charcoal-900">
              {t("card.rewardWaitingBody", { reward: rewardText })}
            </p>
            {card.rewardsAvailable > 1 ? (
              <p className="mt-2 font-semibold text-charcoal-900">
                {t("card.rewardsReady", { count: card.rewardsAvailable })}
              </p>
            ) : null}
          </div>
        ) : null}

        {active || card.status === "SUSPENDED" ? (
          <section aria-labelledby="progress-title" className="flex flex-col gap-3">
            <h2 id="progress-title" className="text-lg font-bold text-green-900">
              {t("card.progressLabel")}
            </h2>
            <StampProgress
              current={card.progress.current}
              required={card.progress.required}
              rewardReady={rewardWaiting}
            />
            {reward && !rewardWaiting ? (
              <p className="break-words text-charcoal-700" lang={reward.name.lang}>
                {t("card.rewardTarget", { count: card.progress.required, reward: rewardText })}
              </p>
            ) : null}
            {reward?.description.text ? (
              <p className="text-sm break-words text-muted" lang={reward.description.lang}>
                {reward.description.text}
              </p>
            ) : null}
            {card.progress.completedCards > 0 ? (
              <p className="text-sm text-muted" data-testid="card-completed">
                {card.progress.completedCards === 1
                  ? t("card.completedCardsOne")
                  : t("card.completedCards", { count: card.progress.completedCards })}
              </p>
            ) : null}
          </section>
        ) : null}

        {active ? (
          <section aria-labelledby="qr-title" className="flex flex-col items-center gap-3">
            <h2 id="qr-title" className="sr-only">
              {t("card.qrHint")}
            </h2>
            <div
              role="img"
              aria-label={t("card.qrLabel")}
              data-testid="card-qr"
              className="w-full max-w-72 rounded-card border border-border bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
              // The markup is generated by the QR library from the backend value; nothing in it is user text.
              dangerouslySetInnerHTML={{ __html: qr }}
            />
            <p className="text-center text-charcoal-700">{t("card.qrHint")}</p>
            <p className="text-center text-sm text-muted">{t("card.screenshotRisk")}</p>
          </section>
        ) : null}

        <p className="rounded-control bg-cream-200 p-3 text-sm text-charcoal-700">
          {t("wallet.notPaymentCard")}
        </p>

        <p className="text-sm text-muted" data-testid="card-updated">
          {t("card.lastUpdated", { time: format.dateTime(fetchedAt) })}
        </p>

        <CardActions
          cardId={cardId}
          walletHref={`/${locale}/card/wallet?c=${encodeURIComponent(cardId)}`}
          showWallet={active}
        />

        {terms ? (
          <details className="rounded-control border border-border p-3">
            <summary className="cursor-pointer font-medium text-green-800">
              {t("card.terms")}
            </summary>
            <p className="mt-2 break-words whitespace-pre-line text-charcoal-700" lang={terms.lang}>
              {terms.text}
            </p>
          </details>
        ) : null}

        <section aria-labelledby="help-title" className="flex flex-col gap-2">
          <h2 id="help-title" className="font-bold text-green-900">
            {t("card.helpHeading")}
          </h2>
          <p className="text-charcoal-700">{t("card.helpStaff", { business: business.text })}</p>
          {supportUrl ? (
            <div>
              <ButtonLink href={supportUrl} variant="secondary" prefetch={false}>
                {t("card.helpLink")}
              </ButtonLink>
            </div>
          ) : null}
        </section>
      </div>
    </article>
  );
}
