"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, ConfirmDialog, EmptyState, useToast } from "@/components/ui";
import { DashboardSection } from "@/features/dashboard/components/section";
import { ResponsiveTable } from "@/features/org/responsive-table";
import { getBrowserApi } from "@/lib/api/browser";
import type { DeadJob } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import { JOB_STATUS_LABEL, JOB_STATUS_ORDER, JOB_TYPE_LABEL, redactError } from "../ops-rules";

/**
 * Wallet and background-job health. The service records every wallet card update as a background job; jobs that
 * used all their attempts are listed here with a safe summary of what went wrong, and an administrator can give one
 * a fresh set of attempts after fixing the cause. That is the one change this page can make, it needs a
 * confirmation, and the backend records it in the audit history (`outbox.job_requeued`).
 */
export function WalletHealth() {
  const { t, format } = useI18n();
  const client = useQueryClient();
  const toast = useToast();
  const stats = useQuery({
    queryKey: ["ops", "outbox-stats"],
    queryFn: ({ signal }) => getBrowserApi().operations.outboxStats(signal),
  });
  const dead = useQuery({
    queryKey: ["ops", "dead-jobs"],
    queryFn: ({ signal }) => getBrowserApi().operations.deadJobs(signal),
  });
  const [retrying, setRetrying] = useState<DeadJob | null>(null);

  const requeue = useMutation({
    mutationFn: (job: DeadJob) => getBrowserApi().operations.requeueDeadJob(job.id),
  });

  async function confirmRetry() {
    const job = retrying;
    if (!job) return;
    try {
      await requeue.mutateAsync(job);
      toast.show({ tone: "success", title: t("ops.retried") });
    } catch (failure) {
      const e = toApiError(failure);
      toast.show({
        tone: "danger",
        title: e.kind === "not_found" ? t("ops.retryGone") : describeApiError(e, t).description,
      });
    } finally {
      setRetrying(null);
      void client.invalidateQueries({ queryKey: ["ops", "dead-jobs"] });
      void client.invalidateQueries({ queryKey: ["ops", "outbox-stats"] });
    }
  }

  const n = (value: number) => format.integer(value);
  const typeOf = (job: DeadJob) =>
    JOB_TYPE_LABEL[job.type] ? t(JOB_TYPE_LABEL[job.type]!) : job.type;
  const retryButton = (job: DeadJob) => (
    <Button variant="secondary" onClick={() => setRetrying(job)}>
      {t("ops.retry")}
      <span className="sr-only"> — {typeOf(job)}</span>
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <DashboardSection id="job-counts" title={t("ops.walletStatsTitle")} query={stats}>
        {stats.data ? (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {JOB_STATUS_ORDER.map((status) => (
              <div key={status}>
                <dt className="text-sm text-muted">{t(JOB_STATUS_LABEL[status]!)}</dt>
                <dd className="text-2xl font-bold tabular-nums" data-testid={`jobs-${status}`}>
                  {n(stats.data[status] ?? 0)}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </DashboardSection>

      <DashboardSection
        id="dead-jobs"
        title={t("ops.deadTitle")}
        query={dead}
        empty={
          dead.data && dead.data.length === 0 ? (
            <EmptyState title={t("ops.deadEmpty")} description={t("ops.deadEmptyHint")} />
          ) : undefined
        }
      >
        {dead.data ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{t("ops.deadIntro")}</p>
            <ResponsiveTable
              label={t("ops.deadTableLabel")}
              items={dead.data}
              rowKey={(job) => job.id}
              columns={[
                { id: "job", header: t("ops.colJob"), rowHeader: true, cell: typeOf },
                { id: "attempts", header: t("ops.colAttempts"), cell: (job) => n(job.attempts) },
                {
                  id: "created",
                  header: t("ops.colCreated"),
                  cell: (job) => format.dateTime(job.createdAt),
                },
                {
                  id: "error",
                  header: t("ops.colError"),
                  cell: (job) => (
                    <span className="break-words">{redactError(job.lastError) || "—"}</span>
                  ),
                },
                { id: "actions", header: t("ops.colActions"), cell: retryButton },
              ]}
              card={(job) => (
                <div className="flex flex-col gap-2">
                  <p className="font-semibold text-green-900">{typeOf(job)}</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-muted">{t("ops.colAttempts")}</dt>
                    <dd>{n(job.attempts)}</dd>
                    <dt className="text-muted">{t("ops.colCreated")}</dt>
                    <dd>{format.dateTime(job.createdAt)}</dd>
                    <dt className="text-muted">{t("ops.colError")}</dt>
                    <dd className="break-words">{redactError(job.lastError) || "—"}</dd>
                  </dl>
                  {retryButton(job)}
                </div>
              )}
            />
            <p className="text-sm text-muted">{t("ops.errorHidden")}</p>
          </div>
        ) : null}
      </DashboardSection>

      <ConfirmDialog
        open={retrying !== null}
        onCancel={() => setRetrying(null)}
        onConfirm={confirmRetry}
        title={t("ops.retryTitle")}
        description={t("ops.retryBody")}
        confirmLabel={t("ops.retryAction")}
      />
    </div>
  );
}
