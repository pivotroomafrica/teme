"use client";

import { useSyncExternalStore } from "react";

/**
 * False on the server and during hydration, true once the component is interactive. Used to put a
 * `data-hydrated` marker on forms so tests (and nothing else) can wait until clicks will be handled.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}
