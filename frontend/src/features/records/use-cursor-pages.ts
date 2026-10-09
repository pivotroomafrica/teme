"use client";

import { useState } from "react";

/**
 * Cursor paging for lists the backend pages with an opaque `nextCursor`. The cursors already visited are kept so
 * "Previous" can go back; `reset` returns to the first page (used whenever a search or a filter changes).
 */
export function useCursorPages(pageSize: number) {
  const [cursors, setCursors] = useState<string[]>([]);
  const index = cursors.length;
  return {
    cursor: cursors.at(-1),
    index,
    hasPrevious: index > 0,
    next: (nextCursor: string) => setCursors((current) => [...current, nextCursor]),
    previous: () => setCursors((current) => current.slice(0, -1)),
    reset: () => setCursors([]),
    /** 1-based position of the first row on the current page. */
    from: index * pageSize + 1,
  };
}
