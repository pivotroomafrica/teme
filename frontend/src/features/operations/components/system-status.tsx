"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Alert, Badge, Button } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import type { HealthSnapshot } from "./ops-overview";

/**
 * Whether the service is up (liveness) and can reach its database (readiness). The page asks on the server, so
 * "Check again" simply renders it afresh. Only yes or no is shown: settings, keys and credentials are never part of
 * what the service reports and are never displayed.
 */
export function SystemStatus({ health, checkedAt }: { health: HealthSnapshot; checkedAt: string }) {
  const { t, format } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3" aria-label={t("nav.system")}>
        <li className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-surface p-4">
          <span className="font-medium">{t("ops.systemLive")}</span>
          <Badge tone={health.live ? "success" : "danger"}>
            {health.live ? t("ops.readyYes") : t("ops.systemUnreachable")}
          </Badge>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-surface p-4">
          <span className="font-medium">{t("ops.systemReady")}</span>
          <Badge tone={health.ready ? "success" : "danger"}>
            {health.ready ? t("ops.readyYes") : t("ops.readyNo")}
          </Badge>
        </li>
      </ul>
      {health.live && health.ready === false ? (
        <Alert tone="warning">{t("ops.systemNotReady")}</Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" loading={pending} onClick={() => start(() => router.refresh())}>
          {t("ops.checkAgain")}
        </Button>
        <span className="text-sm text-muted">
          {t("ops.systemChecked", { time: format.dateTime(checkedAt) })}
        </span>
      </div>
      <p className="text-sm text-muted">{t("ops.systemNote")}</p>
    </div>
  );
}
