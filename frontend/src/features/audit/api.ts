import { auditPageSchema, parseWith, type AuditPage } from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";

/** Every filter is optional. Dates are calendar days in the business time zone (`to` includes that whole day). */
export interface AuditQuery {
  limit?: number;
  cursor?: string;
  from?: string;
  to?: string;
  actorUserId?: string;
  branchId?: string;
  action?: string;
  actionPrefix?: string;
  targetType?: string;
  targetId?: string;
}

/**
 * The business audit history, newest first. Needs `audit:read`. Owners also receive IP and device details from the
 * backend; this client does not read or keep them.
 */
export function createAuditApi(transport: Transport) {
  return {
    list: (input: AuditQuery = {}, signal?: AbortSignal) =>
      transport.request<AuditPage>({
        method: "GET",
        path: "/merchant/audit",
        query: {
          limit: input.limit ?? 8,
          cursor: input.cursor,
          from: input.from,
          to: input.to,
          actorUserId: input.actorUserId,
          branchId: input.branchId,
          action: input.action,
          actionPrefix: input.actionPrefix,
          targetType: input.targetType,
          targetId: input.targetId,
        },
        signal,
        parse: parseWith(auditPageSchema),
      }),
  };
}
export type AuditApi = ReturnType<typeof createAuditApi>;
