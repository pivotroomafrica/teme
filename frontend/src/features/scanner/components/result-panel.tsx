"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { CheckCircleIcon, WarningIcon, XCircleIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { pickLocalized } from "@/features/enrollment/localized";
import { useI18n } from "@/lib/i18n/client";
import { cooldownMinutes, rejectionView, type DoneOutcome } from "../scanner-flow";

/** Seconds a successful stamp stays on screen before the scanner is ready again by itself. */
export const AUTO_RETURN_SECONDS = 6;

/**
 * A full-width result the whole counter can read from arm's length. Meaning is carried three ways, never by
 * colour alone: a large symbol (tick, cross, warning), a headline in words, and a different colour.
 */
function Banner({
  tone,
  icon,
  title,
  children,
  testId,
}: {
  tone: "success" | "danger" | "warning";
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  testId: string;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className={cn(
        "flex flex-col items-center gap-3 rounded-card p-6 text-center",
        tone === "success" && "bg-green-700 text-white",
        tone === "danger" && "bg-red-700 text-white",
        tone === "warning" && "bg-gold-500 text-charcoal-900",
      )}
    >
      <span aria-hidden="true">{icon}</span>
      <h2 className="text-3xl font-bold">{title}</h2>
      {children}
    </div>
  );
}

export function ResultPanel({
  outcome,
  onNext,
}: {
  outcome: DoneOutcome;
  /** Returns to scanning. */
  onNext: () => void;
}) {
  const { t, locale } = useI18n();
  const [seconds, setSeconds] = useState(AUTO_RETURN_SECONDS);
  const autoReturn = outcome.kind === "stamped";

  useEffect(() => {
    if (!autoReturn) return;
    const timer = setInterval(() => setSeconds((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [autoReturn]);

  useEffect(() => {
    if (autoReturn && seconds <= 0) onNext();
  }, [autoReturn, seconds, onNext]);

  let content: ReactNode;
  if (outcome.kind === "stamped") {
    const { result, name } = outcome;
    const reward = result.reward?.unlocked
      ? pickLocalized(locale, result.reward.nameEn ?? "", result.reward.nameAm)
      : null;
    content = (
      <Banner
        tone="success"
        testId="scan-success"
        icon={<CheckCircleIcon size={96} />}
        title={t("scanner.successTitle")}
      >
        {result.progress ? (
          <p className="text-xl">
            {t("scanner.successProgress", {
              name,
              current: result.progress.current,
              required: result.progress.required,
            })}
          </p>
        ) : null}
        {reward ? (
          <p
            className="rounded-control bg-white px-4 py-2 text-lg font-bold text-green-900"
            lang={reward.lang}
          >
            {t("scanner.rewardUnlocked", { reward: reward.text })}
          </p>
        ) : null}
        {result.replayed ? <p className="text-sm">{t("scanner.replayedNote")}</p> : null}
      </Banner>
    );
  } else if (outcome.kind === "redeemed") {
    const reward = outcome.result.reward
      ? pickLocalized(locale, outcome.result.reward.nameEn, outcome.result.reward.nameAm)
      : null;
    content = (
      <Banner
        tone="success"
        testId="redeem-success"
        icon={<CheckCircleIcon size={96} />}
        title={t("scanner.redeemedTitle")}
      >
        {reward ? (
          <p className="text-xl" lang={reward.lang}>
            {t("scanner.redeemedBody", { reward: reward.text })}
          </p>
        ) : null}
        {outcome.result.replayed ? <p className="text-sm">{t("scanner.replayedNote")}</p> : null}
      </Banner>
    );
  } else if (outcome.kind === "notCard") {
    content = (
      <Banner
        tone="danger"
        testId="scan-rejected"
        icon={<XCircleIcon size={96} />}
        title={t("scanner.invalidTitle")}
      >
        <p className="text-lg">{t("scanner.notLoyaltyCard")}</p>
      </Banner>
    );
  } else {
    const view = rejectionView(outcome.reason);
    const detail = outcome.message[locale];
    content = (
      <Banner
        tone={view.tone}
        testId="scan-rejected"
        icon={view.tone === "warning" ? <WarningIcon size={96} /> : <XCircleIcon size={96} />}
        title={t(view.title)}
      >
        {outcome.reason === "COOLDOWN_ACTIVE" ? (
          <p className="text-lg">
            {t("scanner.cooldownWait", { minutes: cooldownMinutes(outcome.retryAfterSeconds) })}
          </p>
        ) : view.body ? (
          <p className="text-lg">{t(view.body)}</p>
        ) : null}
        {detail ? <p className="text-sm opacity-90">{detail}</p> : null}
      </Banner>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="scan-result">
      {content}
      <Button size="lg" fullWidth onClick={onNext}>
        {t("scanner.scanNext")}
      </Button>
      {autoReturn ? (
        <p className="text-center text-sm text-muted">
          {t("scanner.backToScanning", { seconds: Math.max(0, seconds) })}
        </p>
      ) : null}
    </div>
  );
}
