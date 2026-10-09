"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Badge, MetricCard } from "@/components/ui";
import { DashboardSection } from "@/features/dashboard/components/section";
import { getBrowserApi } from "@/lib/api/browser";
import { useI18n } from "@/lib/i18n/client";
import { JOB_STATUS_LABEL, JOB_STATUS_ORDER } from "../ops-rules";
import { Unavailable } from "./unavailable";

export interface HealthSnapshot {
  live: boolean;
  /** null when readiness could not be asked at all. */
  ready: boolean | null;
}

/**
 * The operations home: how many merchants are in each state, how the background jobs are doing, whether the service
 * is ready, and a plain list of what the service does not offer to this console yet. Counts are the backend's; the
 * only arithmetic is counting the list it returned by status, which is the list itself rather than a metric.
 */
export function OpsOverview({ health }: { health: HealthSnapshot }) {
  const { t, locale, format } = useI18n();
  const merchants = useQuery({
    queryKey: ["ops", "merchants"],
    queryFn: ({ signal }) => getBrowserApi().operations.merchants(signal),
  });
  const stats = useQuery({
    queryKey: ["ops", "outbox-stats"],
    queryFn: ({ signal }) => getBrowserApi().operations.outboxStats(signal),
  });
  const n = (value: number) => format.integer(value);
  const count = (status: string) => merchants.data?.filter((m) => m.status === status).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t("ops.tileSystem")} className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          label={t("ops.tileSystem")}
          value={
            <Badge tone={health.ready ? "success" : "danger"}>
              {health.ready ? t("ops.readyYes") : t("ops.readyNo")}
            </Badge>
          }
          hint={health.live ? t("ops.systemLive") : t("ops.systemUnreachable")}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DashboardSection id="merchants" title={t("ops.tileMerchants")} query={merchants}>
          {merchants.data ? (
            <div className="flex flex-col gap-3">
              <dl className="grid grid-cols-3 gap-3">
                {(["ACTIVE", "SUSPENDED", "DEACTIVATED"] as const).map((status) => (
                  <div key={status}>
                    <dt className="text-sm text-muted">
                      {t(
                        status === "ACTIVE"
                          ? "ops.statusActive"
                          : status === "SUSPENDED"
                            ? "ops.statusSuspended"
                            : "ops.statusDeactivated",
                      )}
                    </dt>
                    <dd className="text-2xl font-bold tabular-nums">{n(count(status))}</dd>
                  </div>
                ))}
              </dl>
              <Link className="font-medium underline" href={`/${locale}/operations/merchants`}>
                {t("ops.seeAll")}
              </Link>
            </div>
          ) : null}
        </DashboardSection>

        <DashboardSection id="jobs" title={t("ops.tileJobs")} query={stats}>
          {stats.data ? (
            <div className="flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {JOB_STATUS_ORDER.map((status) => (
                  <div key={status}>
                    <dt className="text-sm text-muted">{t(JOB_STATUS_LABEL[status]!)}</dt>
                    <dd className="text-2xl font-bold tabular-nums" data-testid={`jobs-${status}`}>
                      {n(stats.data[status] ?? 0)}
                    </dd>
                  </div>
                ))}
              </dl>
              <Link className="font-medium underline" href={`/${locale}/operations/wallet-health`}>
                {t("ops.seeAll")}
              </Link>
            </div>
          ) : null}
        </DashboardSection>
      </div>

      <section aria-labelledby="not-offered-h" className="flex flex-col gap-2">
        <h2 id="not-offered-h" className="text-lg font-bold text-green-900">
          {t("ops.capabilitiesTitle")}
        </h2>
        <p className="text-muted">{t("ops.capabilitiesIntro")}</p>
        <Unavailable
          items={[
            "ops.capMerchantApproval",
            "ops.capMerchantSummary",
            "ops.capFraud",
            "ops.capPrivacy",
            "ops.capSupport",
            "ops.capAccounts",
          ]}
        />
      </section>
    </div>
  );
}
