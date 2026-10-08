"use client";

import { useState } from "react";
import { RadioGroup, StampProgress, Tabs } from "@/components/ui";
import { MerchantSummary } from "@/features/enrollment/components/merchant-summary";
import { pickLocalized, readableOn, safeBrandColor } from "@/features/enrollment/localized";
import type { JoinInfo } from "@/lib/api/contract";
import type { Locale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import type { ProgramFormValues } from "../program-form";
import { StampIcon } from "./stamp-icon";

const clampStamps = (text: string) => {
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 8;
};

/** Turns the form, as it is right now (saved or not), into what the join page would be given. */
export function draftJoinInfo(
  v: ProgramFormValues,
  merchant: { nameEn: string; nameAm: string | null },
  fallback: { program: string; reward: string },
): JoinInfo {
  return {
    merchant: { nameEn: merchant.nameEn, nameAm: merchant.nameAm, defaultLanguage: "EN" },
    program: {
      nameEn: v.nameEn.trim() || fallback.program,
      nameAm: v.nameAm.trim() || null,
      stampsRequired: clampStamps(v.stampsRequired),
      brandColor: v.brandColor || null,
      cardDisplay: {},
      termsEn: v.termsEn.trim() || null,
      termsAm: v.termsAm.trim() || null,
      reward: {
        nameEn: v.rewardNameEn.trim() || fallback.reward,
        nameAm: v.rewardNameAm.trim() || null,
        descriptionEn: v.rewardDescriptionEn.trim() || null,
        descriptionAm: v.rewardDescriptionAm.trim() || null,
      },
    },
    consent: { version: "preview" },
    wallet: [],
  };
}

/**
 * Three live previews of the program as it is in the form, saved or not: the join page, the web card and a
 * wallet-card sketch. Everything shown is sample data (no real customer, no real QR code), and the previews only
 * draw what the form holds: they never decide anything.
 */
export function ProgramPreviews({
  values,
  merchant,
  dirty,
}: {
  values: ProgramFormValues;
  merchant: { nameEn: string; nameAm: string | null };
  dirty: boolean;
}) {
  const { t } = useI18n();
  const [language, setLanguage] = useState<Locale>("en");
  const [sample, setSample] = useState<number | null>(null);
  const info = draftJoinInfo(values, merchant, {
    program: t("program.previewNoName"),
    reward: t("program.previewNoReward"),
  });
  const required = info.program.stampsRequired;
  const stamps = Math.min(sample ?? Math.min(3, required - 1), required);

  return (
    <section aria-labelledby="preview-title" className="flex flex-col gap-4" data-testid="previews">
      <div>
        <h2 id="preview-title" className="text-lg font-bold text-green-900">
          {t("program.previewTitle")}
        </h2>
        <p className="text-sm text-muted">{t("program.previewNote")}</p>
        {dirty ? (
          <p className="mt-1 text-sm font-medium text-gold-text" data-testid="preview-draft">
            {t("program.previewDraft")}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <RadioGroup
          name="preview-language"
          legend={t("program.previewLanguage")}
          value={language}
          onValueChange={(v) => setLanguage(v as Locale)}
          options={[
            { value: "en", label: t("program.qrEnglish") },
            { value: "am", label: t("program.qrAmharic") },
          ]}
        />
        <label className="flex flex-col gap-1.5 font-medium">
          {t("program.previewStamps")}
          <input
            type="range"
            min={0}
            max={required}
            value={stamps}
            onChange={(event) => setSample(Number(event.target.value))}
            className="w-48 accent-green-700"
          />
        </label>
      </div>

      <Tabs
        label={t("program.previewTitle")}
        tabs={[
          {
            id: "join",
            label: t("program.previewJoin"),
            content: (
              <div
                className="rounded-card border border-border bg-cream-100 p-4"
                data-testid="preview-join"
              >
                <MerchantSummary info={info} locale={language} t={t} />
              </div>
            ),
          },
          {
            id: "web",
            label: t("program.previewWeb"),
            content: <WebCardPreview info={info} stamps={stamps} language={language} />,
          },
          {
            id: "wallet",
            label: t("program.previewWallet"),
            content: (
              <WalletCardPreview info={info} values={values} stamps={stamps} language={language} />
            ),
          },
        ]}
      />
    </section>
  );
}

function WebCardPreview({
  info,
  stamps,
  language,
}: {
  info: JoinInfo;
  stamps: number;
  language: Locale;
}) {
  const { t } = useI18n();
  const business = pickLocalized(language, info.merchant.nameEn, info.merchant.nameAm);
  const program = pickLocalized(language, info.program.nameEn, info.program.nameAm);
  const reward = info.program.reward
    ? pickLocalized(language, info.program.reward.nameEn, info.program.reward.nameAm)
    : null;
  const color = safeBrandColor(info.program.brandColor);
  return (
    <article data-testid="preview-web" aria-label={t("program.previewWeb")} className="max-w-sm">
      <header
        className="rounded-t-card p-4"
        style={{ backgroundColor: color, color: readableOn(color) }}
      >
        <p className="text-lg font-bold break-words" lang={business.lang}>
          {business.text}
        </p>
        <p className="break-words opacity-90" lang={program.lang}>
          {program.text}
        </p>
        <p className="mt-3 font-semibold">
          {t("card.greeting", { name: t("program.previewSampleName") })}
        </p>
      </header>
      <div className="flex flex-col gap-3 rounded-b-card border border-t-0 border-border bg-surface p-4">
        <StampProgress
          current={stamps}
          required={info.program.stampsRequired}
          rewardReady={stamps >= info.program.stampsRequired}
        />
        {reward ? (
          <p className="break-words text-charcoal-700" lang={reward.lang}>
            {t("card.rewardTarget", { count: info.program.stampsRequired, reward: reward.text })}
          </p>
        ) : null}
        <div className="flex h-32 items-center justify-center rounded-card border border-dashed border-charcoal-500 bg-white text-sm text-muted">
          {t("program.previewQr")}
        </div>
      </div>
    </article>
  );
}

function WalletCardPreview({
  info,
  values,
  stamps,
  language,
}: {
  info: JoinInfo;
  values: ProgramFormValues;
  stamps: number;
  language: Locale;
}) {
  const { t } = useI18n();
  const program = pickLocalized(language, info.program.nameEn, info.program.nameAm);
  const color = safeBrandColor(info.program.brandColor);
  const ink = readableOn(color);
  const title = values.cardTitle.trim() || program.text;
  const total = Math.min(info.program.stampsRequired, 20);
  return (
    <article
      data-testid="preview-wallet"
      aria-label={t("program.previewWallet")}
      className="w-full max-w-sm rounded-2xl p-5 shadow-md"
      style={{ backgroundColor: color, color: ink }}
    >
      <p className="text-xl font-bold break-words" lang={program.lang}>
        {title}
      </p>
      {values.cardSubtitle.trim() ? (
        <p className="break-words opacity-90">{values.cardSubtitle}</p>
      ) : null}
      <div
        className="mt-4 flex flex-wrap gap-2"
        role="img"
        aria-label={t("ui.stampProgress", {
          current: Math.min(stamps, total),
          required: info.program.stampsRequired,
        })}
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className="flex h-9 w-9 items-center justify-center rounded-full border-2"
            style={{
              borderColor: ink,
              backgroundColor: i < stamps ? ink : "transparent",
              color: i < stamps ? color : ink,
              opacity: i < stamps ? 1 : 0.6,
            }}
          >
            <StampIcon icon={values.stampIcon} size={18} />
          </span>
        ))}
      </div>
      {values.showProgressText ? (
        <p className="mt-3 font-semibold" data-testid="wallet-progress-text">
          {t("ui.stampProgress", {
            current: Math.min(stamps, info.program.stampsRequired),
            required: info.program.stampsRequired,
          })}
        </p>
      ) : null}
    </article>
  );
}
