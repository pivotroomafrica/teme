"use client";

import { useSyncExternalStore } from "react";
import { detectWalletPlatform, type WalletPlatform } from "./device";

const subscribe = () => () => undefined;

function snapshot(): WalletPlatform {
  return detectWalletPlatform({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

// The server cannot know the device, so it (and the first browser render) show everything; the browser then
// narrows the list. Cached so the snapshot is stable between renders.
let cached: WalletPlatform | undefined;

/** The visitor's phone type, "unknown" on the server and whenever it cannot be told reliably. */
export function useWalletPlatform(): WalletPlatform {
  return useSyncExternalStore(
    subscribe,
    () => (cached ??= snapshot()),
    () => "unknown",
  );
}
