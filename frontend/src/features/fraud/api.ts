import {
  fraudEvaluationSchema,
  fraudFlagPageSchema,
  fraudFlagSchema,
  fraudThresholdsSchema,
  parseWith,
  type FraudFlag,
  type FraudFlagPage,
  type FraudThresholds,
} from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";

export interface FlagQuery {
  limit?: number;
  cursor?: string;
  status?: "OPEN" | "DISMISSED" | "CONFIRMED";
  indicator?: string;
  from?: string;
  to?: string;
}

/**
 * Fraud monitoring (backend/docs/audit-fraud-privacy.md). Indicators only flag things for a person to look at: nothing
 * is blocked, suspended or reported automatically. Reading needs `fraud:read`; reviewing, changing thresholds and
 * running the checks need `fraud:manage` (owners).
 */
export function createFraudApi(transport: Transport) {
  return {
    flags: (query: FlagQuery = {}, signal?: AbortSignal) =>
      transport.request<FraudFlagPage>({
        method: "GET",
        path: "/merchant/fraud/flags",
        query: { limit: query.limit ?? 10, ...query },
        signal,
        parse: parseWith(fraudFlagPageSchema),
      }),

    /** A flag can be reviewed once. The note is kept with the flag only and must not contain personal details. */
    review: (flagId: string, input: { status: "DISMISSED" | "CONFIRMED"; note?: string }) =>
      transport.request<FraudFlag>({
        method: "POST",
        path: "/merchant/fraud/flags/{flagId}/review",
        pathParams: { flagId },
        body: input,
        parse: parseWith(fraudFlagSchema),
      }),

    thresholds: (signal?: AbortSignal) =>
      transport.request<FraudThresholds>({
        method: "GET",
        path: "/merchant/fraud/settings",
        signal,
        parse: parseWith(fraudThresholdsSchema),
      }),

    /** Partial update merged over the current settings; out-of-range values are refused by the backend. */
    updateThresholds: (patch: FraudThresholds) =>
      transport.request<FraudThresholds>({
        method: "PUT",
        path: "/merchant/fraud/settings",
        body: patch,
        parse: parseWith(fraudThresholdsSchema),
      }),

    /** Runs the checks now instead of waiting for the next scheduled run. */
    evaluate: () =>
      transport.request<Record<string, unknown>>({
        method: "POST",
        path: "/merchant/fraud/evaluate",
        parse: parseWith(fraudEvaluationSchema),
      }),
  };
}
export type FraudApi = ReturnType<typeof createFraudApi>;
