import {
  parseWith,
  redeemResultSchema,
  scanResultSchema,
  type RedeemResult,
  type ScanResult,
} from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";
import type { Schemas } from "@/lib/api/types";

/** Safe, non-identifying device facts. Derived from the backend DTO so the allowed values (platform: ios | android | web) cannot drift. */
export type DeviceInfo = Schemas["DeviceDto"];

/**
 * Staff scanner operations. Eligibility is decided by the backend every time; the browser never works out
 * on its own whether a stamp or reward is allowed.
 *
 * State-changing calls (`stamp`, `redeem`) REQUIRE an idempotency key and are sent exactly once by the
 * transport. See lib/api/idempotency.ts for how callers create and reuse keys.
 */
export function createScannerApi(transport: Transport) {
  return {
    /** "Can this card be stamped right now?" Writes nothing. */
    validate: (input: { cardToken: string; branchId?: string }, signal?: AbortSignal) =>
      transport.request<ScanResult>({
        method: "POST",
        path: "/scanner/validate",
        body: input,
        signal,
        parse: parseWith(scanResultSchema),
      }),

    /** Adds exactly one stamp, or answers with a safe rejection (a normal 200 result). */
    stamp: (
      input: { cardToken: string; branchId?: string; device?: DeviceInfo },
      idempotencyKey: string,
      signal?: AbortSignal,
    ) =>
      transport.request<ScanResult>({
        method: "POST",
        path: "/scanner/stamps",
        body: input,
        idempotencyKey,
        signal,
        parse: parseWith(scanResultSchema),
      }),

    /** Lists rewards that can be handed over right now. Writes nothing. */
    lookupRewards: (input: { cardToken: string; branchId?: string }, signal?: AbortSignal) =>
      transport.request<RedeemResult>({
        method: "POST",
        path: "/scanner/rewards/lookup",
        body: input,
        signal,
        parse: parseWith(redeemResultSchema),
      }),

    /** Redeems one reward. Never retried automatically. */
    redeem: (
      input: { cardToken: string; branchId?: string; rewardUnlockId?: string; device?: DeviceInfo },
      idempotencyKey: string,
      signal?: AbortSignal,
    ) =>
      transport.request<RedeemResult>({
        method: "POST",
        path: "/scanner/redemptions",
        body: input,
        idempotencyKey,
        signal,
        parse: parseWith(redeemResultSchema),
      }),
  };
}
export type ScannerApi = ReturnType<typeof createScannerApi>;
