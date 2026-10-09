"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getBrowserApi } from "@/lib/api/browser";
import type { DateRange } from "./api";

/**
 * Analytics reads for the full analytics page. One query per section, so a slow or failing section never blocks the
 * others. The overview, wallet and definitions queries share keys with the dashboard overview, so moving between the
 * two pages reuses what is already loaded instead of asking again.
 */
export const useMonthlyReturningSeries = (months: number, enabled: boolean) =>
  useQuery({
    queryKey: ["analytics", "monthly-returning", months],
    queryFn: ({ signal }) => getBrowserApi().analytics.monthlyReturning({ months }, signal),
    enabled,
  });

/** Branch comparison, 10 at a time; "show more" loads the next page with the backend's cursor. */
export const useBranchPages = (range: DateRange, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: ["analytics", "branches-paged", range.from, range.to],
    queryFn: ({ signal, pageParam }) =>
      getBrowserApi().analytics.branches(range, { limit: 10, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });

export const useStaffPages = (range: DateRange, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: ["analytics", "staff", range.from, range.to],
    queryFn: ({ signal, pageParam }) =>
      getBrowserApi().analytics.staff(range, { limit: 10, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });

export const useCohorts = (cohorts: number, enabled: boolean) =>
  useQuery({
    queryKey: ["analytics", "cohorts", cohorts],
    queryFn: ({ signal }) => getBrowserApi().analytics.cohorts({ cohorts }, signal),
    enabled,
  });
