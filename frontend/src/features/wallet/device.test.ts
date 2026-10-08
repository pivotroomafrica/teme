import { describe, expect, it } from "vitest";
import { detectWalletPlatform, walletProvidersFor } from "./device";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

describe("detectWalletPlatform", () => {
  it("recognises iPhone and Android", () => {
    expect(detectWalletPlatform({ userAgent: IPHONE })).toBe("ios");
    expect(detectWalletPlatform({ userAgent: ANDROID })).toBe("android");
  });

  it("recognises an iPad that presents itself as a Mac, but not a real Mac", () => {
    expect(detectWalletPlatform({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 5 })).toBe(
      "ios",
    );
    expect(detectWalletPlatform({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 0 })).toBe(
      "unknown",
    );
  });

  it("does not guess for desktops or unfamiliar devices", () => {
    expect(detectWalletPlatform({ userAgent: WINDOWS })).toBe("unknown");
    expect(detectWalletPlatform({ userAgent: "" })).toBe("unknown");
  });
});

describe("walletProvidersFor", () => {
  it("offers the matching wallet on a known phone and both when unsure", () => {
    expect(walletProvidersFor("ios")).toEqual(["APPLE"]);
    expect(walletProvidersFor("android")).toEqual(["GOOGLE"]);
    expect(walletProvidersFor("unknown")).toEqual(["APPLE", "GOOGLE"]);
  });
});
