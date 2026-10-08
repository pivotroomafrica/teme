"use client";

import { useState } from "react";
import { Alert, Button, ConfirmDialog } from "@/components/ui";
import { StampProgress } from "@/components/ui/progress";
import { pickLocalized } from "@/features/enrollment/localized";
import type { PublicReward, RedeemResult, ScanResult } from "@/lib/api/contract";
import { useI18n } from "@/lib/i18n/client";
import { canStamp, cooldownMinutes, rejectionView } from "../scanner-flow";

/**
 * After a scan: who the card belongs to, how far along it is, and the two separate things staff can do. Adding a
 * stamp and handing over a reward are different buttons in different sections, and the reward needs an explicit
 * confirmation. Which of them is possible is whatever the backend said; this screen only shows it.
 */
export function ConfirmPanel({
  check,
  rewards,
  disabled,
  onStamp,
  onRedeem,
  onCancel,
}: {
  check: ScanResult;
  rewards: RedeemResult | null;
  /** True while the card's online and ready to act; false offline so nothing can be sent. */
  disabled: boolean;
  onStamp: (name: string) => void;
  onRedeem: (name: string, unlockId: string) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const [pendingReward, setPendingReward] = useState<PublicReward | null>(null);

  const name =
    check.customer?.firstName?.trim() ||
    rewards?.customer?.firstName?.trim() ||
    t("scanner.customerFallback");
  const progress = check.progress ?? rewards?.progress;
  const stampable = canStamp(check);
  const blocked = !stampable && check.reason ? rejectionView(check.reason) : null;
  const available = rewards?.outcome === "AVAILABLE" ? (rewards.rewards ?? []) : [];

  return (
    <div className="flex flex-col gap-5" data-testid="scan-confirm">
      <header className="rounded-card border border-border bg-surface p-4">
        <p className="text-sm font-medium text-muted">{t("scanner.readyTitle")}</p>
        <p
          className="mt-1 text-3xl font-bold break-words text-green-900"
          data-testid="customer-name"
        >
          {name}
        </p>
        {progress ? (
          <StampProgress
            className="mt-3"
            current={progress.current}
            required={progress.required}
            rewardReady={available.length > 0}
          />
        ) : null}
      </header>

      {stampable ? (
        <section aria-labelledby="stamp-title" className="flex flex-col gap-3">
          <h2 id="stamp-title" className="text-xl font-bold text-green-900">
            {t("scanner.readyTitle")}
          </h2>
          <p className="text-charcoal-700">{t("scanner.readyBody")}</p>
          {check.wouldUnlockReward ? <Alert tone="info">{t("scanner.wouldUnlock")}</Alert> : null}
          <Button size="lg" fullWidth disabled={disabled} onClick={() => onStamp(name)}>
            {t("scanner.addStamp")}
          </Button>
        </section>
      ) : blocked ? (
        <Alert tone={blocked.tone === "warning" ? "warning" : "danger"} title={t(blocked.title)}>
          {check.reason === "COOLDOWN_ACTIVE"
            ? t("scanner.cooldownWait", { minutes: cooldownMinutes(check.retryAfterSeconds) })
            : check.message[locale]}
        </Alert>
      ) : null}

      {available.length > 0 ? (
        <section
          aria-labelledby="reward-title"
          className="flex flex-col gap-3 rounded-card border-2 border-gold-600 bg-gold-100 p-4"
          data-testid="reward-section"
        >
          <h2 id="reward-title" className="text-xl font-bold text-charcoal-900">
            {t("scanner.rewardSectionTitle")}
          </h2>
          <p className="text-charcoal-900">{t("scanner.rewardSectionBody")}</p>
          <ul className="flex flex-col gap-3">
            {available.map((reward) => {
              const label = pickLocalized(locale, reward.nameEn, reward.nameAm);
              return (
                <li key={reward.unlockId} className="flex flex-col gap-2">
                  <p className="text-lg font-bold break-words text-charcoal-900" lang={label.lang}>
                    {label.text}
                  </p>
                  <Button
                    size="lg"
                    variant="secondary"
                    fullWidth
                    disabled={disabled}
                    onClick={() => setPendingReward(reward)}
                  >
                    {t("scanner.redeemButton")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <Button variant="ghost" fullWidth onClick={onCancel}>
        {t("scanner.cancelScan")}
      </Button>

      <ConfirmDialog
        open={pendingReward !== null}
        title={t("confirm.redeemTitle")}
        description={
          pendingReward
            ? t("scanner.redeemConfirmBody", {
                name,
                reward: pickLocalized(locale, pendingReward.nameEn, pendingReward.nameAm).text,
              })
            : undefined
        }
        confirmLabel={t("scanner.redeemButton")}
        cancelLabel={t("confirm.no")}
        onCancel={() => setPendingReward(null)}
        onConfirm={() => {
          const reward = pendingReward;
          setPendingReward(null);
          if (reward) onRedeem(name, reward.unlockId);
        }}
      />
    </div>
  );
}
