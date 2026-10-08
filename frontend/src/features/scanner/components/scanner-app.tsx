"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert } from "@/components/ui";
import { DotIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/client";
import { useScanner } from "../use-scanner";
import { CameraPanel } from "./camera-panel";
import { ConfirmPanel } from "./confirm-panel";
import { ManualEntry } from "./manual-entry";
import { ProblemPanel } from "./problem-panel";
import { RecentActivity } from "./recent-activity";
import { ResultPanel } from "./result-panel";

/**
 * The staff scanner screen. Built for one hand on a phone at a counter: one thing on screen at a time, big
 * controls, results readable at arm's length.
 *
 * Offline stamping does not exist: while the phone is offline the actions are disabled, and a stamp or reward is
 * only ever shown as done after the backend has confirmed it.
 */
export function ScannerApp({ branchId, branchName }: { branchId: string; branchName: string }) {
  const { t, locale } = useI18n();
  const scanner = useScanner({ branchId });
  const [cameraOn, setCameraOn] = useState(false);
  const { phase } = scanner.state;
  const scanning = phase.name === "ready" || phase.name === "checking";

  return (
    <div className="flex flex-col gap-5" data-testid="scanner" data-phase={phase.name}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="font-medium text-charcoal-700">
          {t("scanner.workingAt", { branch: branchName })}
        </p>
        <span
          className="inline-flex items-center gap-1.5 font-medium"
          data-testid="connection"
          data-online={scanner.online}
        >
          <DotIcon size={14} className={scanner.online ? "text-green-700" : "text-red-700"} />
          {scanner.online ? t("scanner.connectionOnline") : t("scanner.connectionOffline")}
        </span>
      </div>

      {!scanner.online ? (
        <Alert tone="warning" title={t("scanner.offlineTitle")}>
          {t("scanner.offlineBody")}
        </Alert>
      ) : null}

      {scanning ? (
        <>
          {phase.name === "checking" ? (
            <p
              role="status"
              aria-live="polite"
              className="rounded-card bg-cream-200 p-4 text-center text-lg font-medium"
            >
              {t("scanner.checking")}
            </p>
          ) : null}
          <CameraPanel
            enabled={cameraOn}
            onEnabledChange={setCameraOn}
            paused={phase.name !== "ready" || !scanner.online}
            onCode={scanner.submitCode}
          />
          <ManualEntry
            disabled={phase.name !== "ready" || !scanner.online}
            onCode={scanner.submitCode}
          />
          <RecentActivity entries={scanner.state.recent} />
        </>
      ) : null}

      {phase.name === "confirm" ? (
        <ConfirmPanel
          check={phase.check}
          rewards={phase.rewards}
          disabled={!scanner.online}
          onStamp={(name) => void scanner.confirmStamp(phase.token, name)}
          onRedeem={(name, unlockId) => void scanner.confirmRedeem(phase.token, name, unlockId)}
          onCancel={scanner.dismiss}
        />
      ) : null}

      {phase.name === "stamping" || phase.name === "redeeming" ? (
        <p
          role="status"
          aria-busy="true"
          className="rounded-card bg-cream-200 p-8 text-center text-2xl font-bold text-green-900"
          data-testid="scan-busy"
        >
          {phase.name === "stamping" ? t("scanner.stamping") : t("scanner.redeeming")}
        </p>
      ) : null}

      {phase.name === "done" ? (
        <ResultPanel outcome={phase.outcome} onNext={scanner.dismiss} />
      ) : null}

      {phase.name === "problem" ? (
        <ProblemPanel
          problem={phase}
          online={scanner.online}
          onRetry={scanner.retry}
          onCancel={scanner.dismiss}
        />
      ) : null}

      <p className="text-center text-sm">
        <Link href={`/${locale}/staff/branch`}>{t("auth.switchBranch")}</Link>
      </p>
    </div>
  );
}
