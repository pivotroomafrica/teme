"use client";

import { Button } from "@/components/ui";
import { WarningIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translator";
import type { Phase } from "../scanner-flow";

type Problem = Extract<Phase, { name: "problem" }>;

const TITLES: Record<Problem["kind"], MessageKey> = {
  offline: "scanner.offlineTitle",
  unavailable: "scanner.unavailableTitle",
  permission: "scanner.permissionTitle",
  rate: "errors.rateLimited",
  unexpected: "errors.genericTitle",
};

/**
 * Shown when a request could not be completed. It says plainly whether anything may have been recorded: after a
 * lost connection the stamp or reward is *unknown* (not "failed"), and staff are asked to check again with the
 * very same request before doing anything else. Checking again is always a deliberate tap, never automatic.
 */
export function ProblemPanel({
  problem,
  online,
  onRetry,
  onCancel,
}: {
  problem: Problem;
  online: boolean;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const { kind, pending, uncertain } = problem;

  let body: string;
  if (uncertain && pending.action === "stamp") body = t("scanner.uncertainStamp");
  else if (uncertain && pending.action === "redeem") body = t("scanner.uncertainRedeem");
  else if (kind === "offline") body = t("scanner.offlineBody");
  else if (kind === "unavailable") body = t("scanner.unavailableBody");
  else if (kind === "permission") body = t("scanner.permissionBody");
  else if (kind === "rate")
    body =
      problem.retryAfterSeconds !== undefined
        ? t("errors.rateLimitedSeconds", { seconds: problem.retryAfterSeconds })
        : t("errors.rateLimited");
  else body = t("errors.unexpected");

  const canRetry = kind !== "permission";

  return (
    <div className="flex flex-col gap-4" data-testid="scan-problem" data-kind={kind}>
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-card bg-gold-500 p-6 text-center text-charcoal-900"
      >
        <span aria-hidden="true">
          <WarningIcon size={96} />
        </span>
        <h2 className="text-3xl font-bold">{t(TITLES[kind])}</h2>
        <p className="text-lg">{body}</p>
      </div>
      {canRetry ? (
        <Button size="lg" fullWidth onClick={onRetry} disabled={!online}>
          {t("scanner.checkAgain")}
        </Button>
      ) : null}
      <Button variant="ghost" fullWidth onClick={onCancel}>
        {t("scanner.cancelScan")}
      </Button>
    </div>
  );
}
