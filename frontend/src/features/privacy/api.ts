import {
  anonymizeResultSchema,
  customerDataSchema,
  parseWith,
  retentionPolicySchema,
  retentionRunSchema,
  type AnonymizeResult,
  type CustomerData,
  type RetentionPolicy,
  type RetentionRun,
} from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";

export type AnonymizeReason =
  "CUSTOMER_REQUEST" | "RETENTION_POLICY" | "LEGAL_OBLIGATION" | "OTHER";

/**
 * Privacy tools (backend/docs/audit-fraud-privacy.md). All need `privacy:manage` (owners). Viewing, exporting and
 * anonymising are recorded in the audit log by the backend, which never stores the customer's details there.
 */
export function createPrivacyApi(transport: Transport) {
  return {
    /** Profile, consent history, memberships, wallet passes and the full visit history of one customer. */
    customerData: (customerId: string, signal?: AbortSignal) =>
      transport.request<CustomerData>({
        method: "GET",
        path: "/merchant/customers/{customerId}/data",
        pathParams: { customerId },
        signal,
        parse: parseWith(customerDataSchema),
      }),

    /** The same content as a portable copy; the screen turns it into a file download. */
    exportCustomer: (customerId: string, signal?: AbortSignal) =>
      transport.request<CustomerData>({
        method: "GET",
        path: "/merchant/customers/{customerId}/export",
        pathParams: { customerId },
        signal,
        parse: parseWith(customerDataSchema),
      }),

    /**
     * Irreversible. 409 REWARDS_OUTSTANDING when the customer still has an unclaimed reward and
     * `acknowledgeOutstandingRewards` is not true. Repeating the call is harmless.
     */
    anonymize: (
      customerId: string,
      input: { reason: AnonymizeReason; acknowledgeOutstandingRewards?: boolean },
    ) =>
      transport.request<AnonymizeResult>({
        method: "POST",
        path: "/merchant/customers/{customerId}/anonymize",
        pathParams: { customerId },
        body: input,
        parse: parseWith(anonymizeResultSchema),
      }),

    getRetention: (signal?: AbortSignal) =>
      transport.request<RetentionPolicy>({
        method: "GET",
        path: "/merchant/privacy/retention",
        signal,
        parse: parseWith(retentionPolicySchema),
      }),

    /** 0 turns automatic anonymisation off, otherwise 6 to 120 months. */
    setRetention: (inactiveCustomerMonths: number) =>
      transport.request<RetentionPolicy>({
        method: "PUT",
        path: "/merchant/privacy/retention",
        body: { inactiveCustomerMonths },
        parse: parseWith(retentionPolicySchema),
      }),

    /** Applies the period now to up to 200 customers; `more` says whether to call again. */
    runRetention: () =>
      transport.request<RetentionRun>({
        method: "POST",
        path: "/merchant/privacy/retention/run",
        parse: parseWith(retentionRunSchema),
      }),
  };
}
export type PrivacyApi = ReturnType<typeof createPrivacyApi>;
