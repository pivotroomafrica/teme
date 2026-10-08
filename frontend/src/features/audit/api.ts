import { auditPageSchema, parseWith, type AuditPage } from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";

/**
 * The business audit history, newest first. Needs `audit:read`. Owners also receive IP and device details from the
 * backend; this client does not read or keep them.
 */
export function createAuditApi(transport: Transport) {
  return {
    list: (input: { limit?: number; cursor?: string } = {}, signal?: AbortSignal) =>
      transport.request<AuditPage>({
        method: "GET",
        path: "/merchant/audit",
        query: { limit: input.limit ?? 8, cursor: input.cursor },
        signal,
        parse: parseWith(auditPageSchema),
      }),
  };
}
export type AuditApi = ReturnType<typeof createAuditApi>;
