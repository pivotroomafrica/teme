import {
  invalidatedPassesSchema,
  ledgerSchema,
  membershipSummarySchema,
  parseWith,
  reissuedCardSchema,
  reversalResultSchema,
  walletPassListSchema,
  type Ledger,
  type MembershipSummary,
  type ReversalResult,
  type WalletPass,
} from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";

/**
 * One membership (a customer's card in one program): progress and rewards, the visit ledger, wallet cards, and
 * reversals.
 *
 *  - progress and rewards need `customer:read`; the ledger and reversals need `reversal:create` (owners and
 *    managers). The backend enforces it; a refusal is shown in words.
 *  - A reversal never edits or removes the original event. It **appends** a compensating event that points at it,
 *    and everything shown afterwards is derived from the whole ledger. `reason` (3 to 500 characters) is mandatory.
 *  - Reversals need an idempotency key: one per attempt, reused if the answer is lost, so a flaky connection can
 *    never reverse twice. They are sent exactly once by the transport; a retry is always a deliberate tap.
 */
export function createMembershipsApi(transport: Transport) {
  const at = (membershipId: string) => ({ membershipId });
  return {
    summary: (membershipId: string, signal?: AbortSignal) =>
      transport.request<MembershipSummary>({
        method: "GET",
        path: "/merchant/memberships/{membershipId}/rewards",
        pathParams: at(membershipId),
        signal,
        parse: parseWith(membershipSummarySchema),
      }),

    ledger: (membershipId: string, signal?: AbortSignal) =>
      transport.request<Ledger>({
        method: "GET",
        path: "/merchant/memberships/{membershipId}/ledger",
        pathParams: at(membershipId),
        signal,
        parse: parseWith(ledgerSchema),
      }),

    walletPasses: (membershipId: string, signal?: AbortSignal) =>
      transport.request<WalletPass[]>({
        method: "GET",
        path: "/merchant/memberships/{membershipId}/wallet-passes",
        pathParams: at(membershipId),
        signal,
        parse: parseWith(walletPassListSchema),
      }),

    /** Stops the card working at the counter at once; history and personal data are kept. Needs customer:manage. */
    deactivate: (membershipId: string) =>
      transport.request<void>({
        method: "POST",
        path: "/merchant/memberships/{membershipId}/deactivate",
        pathParams: at(membershipId),
      }),

    reactivate: (membershipId: string) =>
      transport.request<void>({
        method: "POST",
        path: "/merchant/memberships/{membershipId}/reactivate",
        pathParams: at(membershipId),
      }),

    /** A replacement card token; the old one stops working. The token is shown once and not kept. */
    reissueCard: (membershipId: string) =>
      transport.request<{ token: string }>({
        method: "POST",
        path: "/merchant/memberships/{membershipId}/reissue-card",
        pathParams: at(membershipId),
        parse: parseWith(reissuedCardSchema),
      }),

    /** Lost or stolen phone: the Apple and Google passes stop being accepted. The web card keeps working. */
    invalidatePasses: (membershipId: string) =>
      transport.request<{ invalidated: number }>({
        method: "POST",
        path: "/merchant/memberships/{membershipId}/wallet-passes/invalidate",
        pathParams: at(membershipId),
        parse: parseWith(invalidatedPassesSchema),
      }),

    /** Queues a fresh delivery of one pass to its wallet (202). */
    resyncPass: (passId: string) =>
      transport.request<void>({
        method: "POST",
        path: "/merchant/wallet-passes/{passId}/resync",
        pathParams: { passId },
      }),

    reverseStamp: (stampId: string, reason: string, idempotencyKey: string) =>
      transport.request<ReversalResult>({
        method: "POST",
        path: "/merchant/stamps/{stampId}/reverse",
        pathParams: { stampId },
        body: { reason },
        idempotencyKey,
        parse: parseWith(reversalResultSchema),
      }),

    reverseRedemption: (redemptionId: string, reason: string, idempotencyKey: string) =>
      transport.request<ReversalResult>({
        method: "POST",
        path: "/merchant/redemptions/{redemptionId}/reverse",
        pathParams: { redemptionId },
        body: { reason },
        idempotencyKey,
        parse: parseWith(reversalResultSchema),
      }),
  };
}
export type MembershipsApi = ReturnType<typeof createMembershipsApi>;
