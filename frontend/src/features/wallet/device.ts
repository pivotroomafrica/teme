export type WalletProvider = "APPLE" | "GOOGLE";
export type WalletPlatform = "ios" | "android" | "unknown";

/**
 * Which phone this is, when it can be told reliably. Apple Wallet exists on iPhone and iPad; Google Wallet on
 * Android. Anything else (a desktop browser, an unfamiliar device, a privacy setting that hides the details)
 * is "unknown", and then both options are offered rather than guessing.
 */
export function detectWalletPlatform(input: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}): WalletPlatform {
  const ua = input.userAgent;
  if (/iPhone|iPod|iPad/.test(ua)) return "ios";
  // iPadOS 13+ presents itself as a Mac but, unlike a Mac, has a touch screen.
  if (/Macintosh/.test(ua) && input.platform === "MacIntel" && (input.maxTouchPoints ?? 0) > 1) {
    return "ios";
  }
  if (/Android/.test(ua)) return "android";
  return "unknown";
}

/** The wallet buttons worth showing on this device. The web card is always offered besides these. */
export function walletProvidersFor(platform: WalletPlatform): WalletProvider[] {
  if (platform === "ios") return ["APPLE"];
  if (platform === "android") return ["GOOGLE"];
  return ["APPLE", "GOOGLE"];
}
