import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/errors/api-error";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/messages/en";
import type { WalletPlatform } from "./device";
import { WalletSelector } from "./wallet-selector";

const walletLink = vi.fn();
vi.mock("@/features/card/card-client", () => ({
  cardClient: { walletLink: (...args: unknown[]) => walletLink(...args) },
}));

const WEB_HREF = "/en/card?c=abc";
const assign = vi.fn();

beforeEach(() => {
  walletLink.mockReset();
  assign.mockReset();
  vi.stubGlobal("location", { ...window.location, assign });
});
afterEach(() => vi.unstubAllGlobals());

function setup(
  props: {
    platform?: WalletPlatform;
    availability?: Parameters<typeof WalletSelector>[0]["availability"];
  } = {},
) {
  render(
    <I18nProvider locale="en" messages={en}>
      <WalletSelector cardId="abc" webCardHref={WEB_HREF} {...props} />
    </I18nProvider>,
  );
  return userEvent.setup();
}

const apple = () => screen.queryByRole("button", { name: "Add to Apple Wallet" });
const google = () => screen.queryByRole("button", { name: "Add to Google Wallet" });

describe("WalletSelector", () => {
  it("says this is a loyalty card and not a payment card", () => {
    setup();
    expect(screen.getByText(/It is not a payment card/)).toBeInTheDocument();
  });

  it("always offers the web card", () => {
    for (const platform of ["ios", "android", "unknown"] as const) {
      const { unmount } = render(
        <I18nProvider locale="en" messages={en}>
          <WalletSelector webCardHref={WEB_HREF} platform={platform} />
        </I18nProvider>,
      );
      expect(screen.getByRole("link", { name: "Open my web card" })).toHaveAttribute(
        "href",
        WEB_HREF,
      );
      unmount();
    }
  });

  it("shows only Apple Wallet on an iPhone", () => {
    setup({ platform: "ios" });
    expect(apple()).toBeInTheDocument();
    expect(google()).not.toBeInTheDocument();
  });

  it("shows only Google Wallet on an Android phone", () => {
    setup({ platform: "android" });
    expect(google()).toBeInTheDocument();
    expect(apple()).not.toBeInTheDocument();
  });

  it("shows both when the device cannot be told", () => {
    setup({ platform: "unknown" });
    expect(apple()).toBeInTheDocument();
    expect(google()).toBeInTheDocument();
  });

  it("opens the Google Wallet link the backend provides", async () => {
    walletLink.mockResolvedValue({
      kind: "REDIRECT",
      url: "https://wallet.example.test/google/pass",
    });
    const user = setup({ platform: "android" });
    await user.click(google()!);
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://wallet.example.test/google/pass"),
    );
    expect(walletLink).toHaveBeenCalledWith("GOOGLE", "abc");
  });

  it("opens the Apple Wallet link the backend provides", async () => {
    walletLink.mockResolvedValue({
      kind: "DOWNLOAD",
      url: "https://wallet.example.test/apple/pass",
    });
    const user = setup({ platform: "ios" });
    await user.click(apple()!);
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://wallet.example.test/apple/pass"),
    );
    expect(walletLink).toHaveBeenCalledWith("APPLE", "abc");
  });

  it("never opens a link that is not https", async () => {
    walletLink.mockResolvedValue({ kind: "REDIRECT", url: "javascript:alert(1)" });
    const user = setup({ platform: "android" });
    await user.click(google()!);
    expect(await screen.findByText(en.wallet.linkFailed)).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it("points to the web card when the business has not set the wallet up", async () => {
    walletLink.mockRejectedValue(
      new ApiError({
        kind: "conflict",
        code: "PROVIDER_NOT_AVAILABLE",
        message: "no",
        status: 409,
      }),
    );
    const user = setup({ platform: "ios" });
    await user.click(apple()!);
    expect(await screen.findByText(en.wallet.notOfferedNow)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open my web card" })).toBeInTheDocument();
  });

  it("reports a failure to reach the wallet and keeps the web card available", async () => {
    walletLink.mockRejectedValue(
      new ApiError({ kind: "network", code: "NETWORK_ERROR", message: "x" }),
    );
    const user = setup({ platform: "android" });
    await user.click(google()!);
    expect(await screen.findByText(en.wallet.linkFailed)).toBeInTheDocument();
    expect(google()).toBeEnabled();
  });

  it("disables a wallet the backend reported as unavailable, and says so", () => {
    setup({
      platform: "unknown",
      availability: [
        { provider: "WEB", available: true, reason: null, addUrl: null },
        { provider: "APPLE", available: false, reason: "NOT_CONFIGURED", addUrl: null },
        { provider: "GOOGLE", available: true, reason: null, addUrl: null },
      ],
    });
    expect(apple()).toBeDisabled();
    expect(google()).toBeEnabled();
    expect(screen.getByText(en.wallet.statusUnavailable)).toBeInTheDocument();
  });
});
