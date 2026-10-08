"use client";

import { useState } from "react";

export const PAGE_SIZE = 10;

/**
 * Pages a list that is already in memory. The backend returns branches and team members as one complete list (it
 * has no paging for them), so large lists are cut into pages here to keep the screen short and fast to scan.
 * The current page can never point past the end: when a search or a change shortens the list, it steps back.
 */
export function usePaged<T>(items: readonly T[], pageSize: number = PAGE_SIZE) {
  const [requested, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(requested, pages);
  const start = (page - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    page,
    pages,
    slice,
    total: items.length,
    from: items.length === 0 ? 0 : start + 1,
    to: start + slice.length,
    hasPrevious: page > 1,
    hasNext: page < pages,
    previous: () => setPage(Math.max(1, page - 1)),
    next: () => setPage(Math.min(pages, page + 1)),
    reset: () => setPage(1),
  };
}
