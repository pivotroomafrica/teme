"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowserApi } from "@/lib/api/browser";
import type { DateRange } from "@/features/analytics/api";

/**
 * One query per dashboard section, so a slow or failing section never blocks the others (partial data is a
 * normal state). Every query is a read: safe to retry, and nothing is calculated from the answers here.
 */
export const useOverview = (range: DateRange, enabled: boolean) =>
  useQuery({
    queryKey: ["analytics", "overview", range.from, range.to],
    queryFn: ({ signal }) => getBrowserApi().analytics.overview(range, signal),
    enabled,
  });

export const useMonthlyReturning = (enabled: boolean) =>
  useQuery({
    queryKey: ["analytics", "monthly-returning", 6],
    queryFn: ({ signal }) => getBrowserApi().analytics.monthlyReturning({ months: 6 }, signal),
    enabled,
  });

export const useBranchActivity = (range: DateRange, enabled: boolean) =>
  useQuery({
    queryKey: ["analytics", "branches", range.from, range.to],
    queryFn: ({ signal }) => getBrowserApi().analytics.branches(range, { limit: 10 }, signal),
    enabled,
  });

export const useWalletHealth = (range: DateRange, enabled: boolean) =>
  useQuery({
    queryKey: ["analytics", "wallet", range.from, range.to],
    queryFn: ({ signal }) => getBrowserApi().analytics.wallet(range, signal),
    enabled,
  });

export const useDefinitions = (enabled: boolean) =>
  useQuery({
    queryKey: ["analytics", "definitions"],
    queryFn: ({ signal }) => getBrowserApi().analytics.definitions(signal),
    enabled,
    staleTime: 60 * 60 * 1000,
  });

export const useRecentEvents = (enabled: boolean) =>
  useQuery({
    queryKey: ["audit", "recent", 8],
    queryFn: ({ signal }) => getBrowserApi().audit.list({ limit: 8 }, signal),
    enabled,
  });
