import {
  auditPageSchema,
  deadJobListSchema,
  deadJobSchema,
  healthSchema,
  outboxStatsSchema,
  parseWith,
  platformMerchantListSchema,
  type AuditPage,
  type DeadJob,
  type Health,
  type OutboxStats,
  type PlatformMerchant,
} from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";
import type { AuditQuery } from "@/features/audit/api";

/** The platform audit accepts the merchant filters plus `merchantId`. Naming a merchant is itself recorded. */
export type PlatformAuditQuery = AuditQuery & { merchantId?: string };

/**
 * Platform-administrator operations. Every route needs an explicit platform permission (`platform:manage`, and
 * `platform:audit:read` for the audit), and the backend enforces it on each call: a merchant account is refused
 * with 403 whatever the screens do. Reads only, except re-queueing a dead outbox job, which the backend audits.
 */
export function createOperationsApi(transport: Transport) {
  return {
    merchants: (signal?: AbortSignal) =>
      transport.request<PlatformMerchant[]>({
        method: "GET",
        path: "/platform/merchants",
        signal,
        parse: parseWith(platformMerchantListSchema),
      }),

    outboxStats: (signal?: AbortSignal) =>
      transport.request<OutboxStats>({
        method: "GET",
        path: "/platform/outbox/stats",
        signal,
        parse: parseWith(outboxStatsSchema),
      }),

    deadJobs: (signal?: AbortSignal) =>
      transport.request<DeadJob[]>({
        method: "GET",
        path: "/platform/outbox/dead",
        signal,
        parse: parseWith(deadJobListSchema),
      }),

    /** Gives a dead job a fresh set of attempts. Audited by the backend as `outbox.job_requeued`. */
    requeueDeadJob: (jobId: string) =>
      transport.request<DeadJob>({
        method: "POST",
        path: "/platform/outbox/dead/{jobId}/requeue",
        pathParams: { jobId },
        parse: parseWith(deadJobSchema),
      }),

    audit: (input: PlatformAuditQuery = {}, signal?: AbortSignal) =>
      transport.request<AuditPage>({
        method: "GET",
        path: "/platform/audit",
        query: {
          limit: input.limit ?? 10,
          cursor: input.cursor,
          from: input.from,
          to: input.to,
          actorUserId: input.actorUserId,
          branchId: input.branchId,
          action: input.action,
          actionPrefix: input.actionPrefix,
          targetType: input.targetType,
          targetId: input.targetId,
          merchantId: input.merchantId,
        },
        signal,
        parse: parseWith(auditPageSchema),
      }),

    /** Public liveness and readiness. Readiness answers 503 while the database is unreachable. */
    health: (signal?: AbortSignal) =>
      transport.request<Health>({
        method: "GET",
        path: "/health",
        signal,
        parse: parseWith(healthSchema),
      }),
    ready: (signal?: AbortSignal) =>
      transport.request<Health>({
        method: "GET",
        path: "/health/ready",
        signal,
        parse: parseWith(healthSchema),
      }),
  };
}
export type OperationsApi = ReturnType<typeof createOperationsApi>;
