import {
  analyticsOverviewSchema,
  branchActivityPageSchema,
  metricDefinitionsSchema,
  monthlyReturningSchema,
  parseWith,
  walletHealthSchema,
  type AnalyticsOverview,
  type BranchActivityPage,
  type MetricDefinitions,
  type MonthlyReturning,
  type WalletHealth,
} from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";

/** A calendar-date range (YYYY-MM-DD, read in the business time zone; `to` includes that whole day). */
export interface DateRange {
  from: string;
  to: string;
}

/**
 * Loyalty analytics. Every number is computed by the backend from its published definitions (see
 * `definitions()`); the browser only chooses the range and displays what comes back. Needs `analytics:read`.
 */
export function createAnalyticsApi(transport: Transport) {
  return {
    overview: (range: DateRange, signal?: AbortSignal) =>
      transport.request<AnalyticsOverview>({
        method: "GET",
        path: "/merchant/analytics/overview",
        query: { from: range.from, to: range.to },
        signal,
        parse: parseWith(analyticsOverviewSchema),
      }),

    /** The north-star metric for `month` (default: the current month) and the months before it. */
    monthlyReturning: (input: { month?: string; months?: number } = {}, signal?: AbortSignal) =>
      transport.request<MonthlyReturning>({
        method: "GET",
        path: "/merchant/analytics/monthly-returning-customers",
        query: { month: input.month, months: input.months ?? 6 },
        signal,
        parse: parseWith(monthlyReturningSchema),
      }),

    branches: (range: DateRange, input: { limit?: number } = {}, signal?: AbortSignal) =>
      transport.request<BranchActivityPage>({
        method: "GET",
        path: "/merchant/analytics/branches",
        query: { from: range.from, to: range.to, limit: input.limit ?? 10 },
        signal,
        parse: parseWith(branchActivityPageSchema),
      }),

    wallet: (range: DateRange, signal?: AbortSignal) =>
      transport.request<WalletHealth>({
        method: "GET",
        path: "/merchant/analytics/wallet",
        query: { from: range.from, to: range.to },
        signal,
        parse: parseWith(walletHealthSchema),
      }),

    /** The wording the numbers are computed with, so screens can explain them in the backend's own terms. */
    definitions: (signal?: AbortSignal) =>
      transport.request<MetricDefinitions>({
        method: "GET",
        path: "/merchant/analytics/definitions",
        signal,
        parse: parseWith(metricDefinitionsSchema),
      }),
  };
}
export type AnalyticsApi = ReturnType<typeof createAnalyticsApi>;
