import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import type { RedeemResult, ScanResult } from "@/lib/api/contract";
import { ApiError } from "@/lib/errors/api-error";
import { I18nProvider } from "@/lib/i18n/client";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";
import { ScannerApp } from "./scanner-app";

const validate = vi.fn();
const lookupRewards = vi.fn();
const stamp = vi.fn();
const redeem = vi.fn();
const search = vi.fn();

vi.mock("@/lib/api/browser", () => ({
  getBrowserApi: () => ({
    scanner: { validate, lookupRewards, stamp, redeem },
    customers: { search },
  }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const MESSAGE = { en: "Backend message", am: "የጀርባ መልዕክት" };
const progress = { current: 3, required: 8, remaining: 5, completedCards: 0, rewardsAvailable: 0 };
const eligible: ScanResult = {
  outcome: "ELIGIBLE",
  reason: null,
  message: MESSAGE,
  customer: { firstName: "Abebe" },
  progress,
  replayed: false,
};
const stamped: ScanResult = {
  ...eligible,
  outcome: "STAMPED",
  progress: { ...progress, current: 4, remaining: 4 },
  stamp: { id: "s1", occurredAt: "2026-10-08T09:00:00Z" },
};
const none: RedeemResult = {
  outcome: "REJECTED",
  reason: "NO_REWARD_AVAILABLE",
  message: MESSAGE,
  replayed: false,
};
const reward = {
  unlockId: "unlock-1",
  nameEn: "Free coffee",
  nameAm: "ነጻ ቡና",
  descriptionEn: null,
  descriptionAm: null,
  unlockedAt: "2026-10-01T09:00:00Z",
  expiresAt: null,
};
const available: RedeemResult = {
  outcome: "AVAILABLE",
  reason: null,
  message: MESSAGE,
  customer: { firstName: "Abebe" },
  rewards: [reward],
  replayed: false,
};

function setup(locale: "en" | "am" = "en") {
  render(
    <I18nProvider locale={locale} messages={locale === "en" ? en : am}>
      <ToastProvider>
        <ScannerApp branchId="branch-1" branchName="Bole branch" />
      </ToastProvider>
    </I18nProvider>,
  );
  return userEvent.setup();
}

/** Types a code into the manual box, as a stand-in for a camera read. */
async function enterCode(user: ReturnType<typeof userEvent.setup>, code = "mock-ok-1-4567") {
  await user.type(screen.getByRole("textbox", { name: /^Card code/ }), code);
  await user.click(screen.getByRole("button", { name: "Look up" }));
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value });
  act(() => {
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  });
}

beforeEach(() => {
  for (const mock of [validate, lookupRewards, stamp, redeem, search]) mock.mockReset();
  setOnline(true);
  validate.mockResolvedValue(eligible);
  lookupRewards.mockResolvedValue(none);
});

describe("ScannerApp", () => {
  it("shows the branch and the connection state", () => {
    setup();
    expect(screen.getByText("Working at Bole branch")).toBeInTheDocument();
    expect(screen.getByTestId("connection")).toHaveTextContent("Online");
    expect(screen.getByRole("link", { name: "Switch branch" })).toHaveAttribute(
      "href",
      "/en/staff/branch",
    );
  });

  it("checks the card with the backend, then waits for confirmation before stamping", async () => {
    const user = setup();
    await enterCode(user);
    expect(await screen.findByTestId("scan-confirm")).toBeInTheDocument();
    expect(validate).toHaveBeenCalledWith(
      { cardToken: "mock-ok-1-4567", branchId: "branch-1" },
      expect.anything(),
    );
    expect(lookupRewards).toHaveBeenCalled();
    expect(screen.getByTestId("customer-name")).toHaveTextContent("Abebe");
    expect(screen.getByRole("img", { name: "3 of 8 stamps" })).toBeInTheDocument();
    // Nothing is written until staff press the button.
    expect(stamp).not.toHaveBeenCalled();
  });

  it("adds a stamp with a unique idempotency key and shows success only after the backend confirms", async () => {
    stamp.mockResolvedValue(stamped);
    const user = setup();
    await enterCode(user);
    await user.click(await screen.findByRole("button", { name: "Add stamp" }));

    const success = await screen.findByTestId("scan-success");
    expect(within(success).getByText("Stamp added")).toBeInTheDocument();
    expect(within(success).getByText("Abebe: 4 of 8 stamps")).toBeInTheDocument();
    expect(stamp).toHaveBeenCalledTimes(1);
    const [input, key] = stamp.mock.calls[0]!;
    expect(input).toEqual({
      cardToken: "mock-ok-1-4567",
      branchId: "branch-1",
      device: { platform: "web" },
    });
    expect(key).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
  });

  it("uses a different key for the next stamp", async () => {
    stamp.mockResolvedValue(stamped);
    const user = setup();
    await enterCode(user);
    await user.click(await screen.findByRole("button", { name: "Add stamp" }));
    await user.click(await screen.findByRole("button", { name: "Scan next card" }));
    await enterCode(user);
    await user.click(await screen.findByRole("button", { name: "Add stamp" }));
    await waitFor(() => expect(stamp).toHaveBeenCalledTimes(2));
    expect(stamp.mock.calls[0]![1]).not.toBe(stamp.mock.calls[1]![1]);
  });

  it("sends one stamp even when the button is hammered", async () => {
    let finish: (value: ScanResult) => void = () => undefined;
    stamp.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = setup();
    await enterCode(user);
    const button = await screen.findByRole("button", { name: "Add stamp" });
    await user.tripleClick(button);
    expect(stamp).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("scan-busy")).toBeInTheDocument();
    finish(stamped);
    expect(await screen.findByTestId("scan-success")).toBeInTheDocument();
  });

  it("explains a cooldown with the wait, in words and with a symbol, and does not stamp", async () => {
    validate.mockResolvedValue({
      outcome: "REJECTED",
      reason: "COOLDOWN_ACTIVE",
      message: MESSAGE,
      retryAfterSeconds: 120,
      customer: { firstName: "Abebe" },
      progress,
      replayed: false,
    });
    const user = setup();
    await enterCode(user);
    const rejected = await screen.findByTestId("scan-rejected");
    expect(within(rejected).getByText("Too soon for another stamp")).toBeInTheDocument();
    expect(within(rejected).getByText("Try again in 2 minutes.")).toBeInTheDocument();
    expect(rejected.querySelector("svg")).not.toBeNull();
    expect(stamp).not.toHaveBeenCalled();
  });

  it.each([
    ["INVALID_TOKEN", "Card not recognised"],
    ["MEMBERSHIP_INACTIVE", "Membership not active"],
    ["PROGRAM_INACTIVE", "Program not active"],
    ["BRANCH_NOT_PERMITTED", "Not allowed at this branch"],
  ] as const)("shows %s as a clear rejection", async (reason, title) => {
    validate.mockResolvedValue({ outcome: "REJECTED", reason, message: MESSAGE, replayed: false });
    lookupRewards.mockResolvedValue({ ...none, reason });
    const user = setup();
    await enterCode(user);
    const rejected = await screen.findByTestId("scan-rejected");
    expect(within(rejected).getByText(title)).toBeInTheDocument();
    expect(within(rejected).getByText("Backend message")).toBeInTheDocument();
  });

  it("shows the backend's message in Amharic on the Amharic page", async () => {
    validate.mockResolvedValue({
      outcome: "REJECTED",
      reason: "INVALID_TOKEN",
      message: MESSAGE,
      replayed: false,
    });
    const user = setup("am");
    await user.type(screen.getByRole("textbox", { name: /^የካርድ ኮድ/ }), "mock-ok-1-4567");
    await user.click(screen.getByRole("button", { name: "ፈልግ" }));
    expect(await screen.findByText("የጀርባ መልዕክት")).toBeInTheDocument();
  });

  it("never sends something that is not a card to the backend", async () => {
    const user = setup();
    await user.type(
      screen.getByRole("textbox", { name: /^Card code/ }),
      "https://example.com/menu",
    );
    await user.click(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByText("That code is not a loyalty card.")).toBeInTheDocument();
    expect(validate).not.toHaveBeenCalled();
  });

  it("asks for a code instead of sending an empty one", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByText("Enter the card code.")).toBeInTheDocument();
    expect(validate).not.toHaveBeenCalled();
  });

  describe("rewards", () => {
    beforeEach(() => lookupRewards.mockResolvedValue(available));

    it("shows an available reward in its own section, apart from adding a stamp", async () => {
      const user = setup();
      await enterCode(user, "mock-reward");
      const section = await screen.findByTestId("reward-section");
      expect(within(section).getByText("Free coffee")).toBeInTheDocument();
      expect(within(section).getByRole("button", { name: "Redeem reward" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add stamp" })).toBeInTheDocument();
      expect(within(section).queryByRole("button", { name: "Add stamp" })).not.toBeInTheDocument();
    });

    it("needs an explicit confirmation before redeeming, and does nothing if cancelled", async () => {
      const user = setup();
      await enterCode(user, "mock-reward");
      await user.click(await screen.findByRole("button", { name: "Redeem reward" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText(/Abebe will receive: Free coffee/)).toBeInTheDocument();
      expect(redeem).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole("button", { name: "No, go back" }));
      expect(redeem).not.toHaveBeenCalled();
      expect(screen.getByTestId("reward-section")).toBeInTheDocument();
    });

    it("redeems once the confirmation is given, with a key and the chosen reward", async () => {
      redeem.mockResolvedValue({
        outcome: "REDEEMED",
        reason: null,
        message: MESSAGE,
        reward,
        replayed: false,
      });
      const user = setup();
      await enterCode(user, "mock-reward");
      await user.click(await screen.findByRole("button", { name: "Redeem reward" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Redeem reward" }));
      const success = await screen.findByTestId("redeem-success");
      expect(within(success).getByText("Reward redeemed")).toBeInTheDocument();
      expect(within(success).getByText("Hand over: Free coffee")).toBeInTheDocument();
      expect(redeem).toHaveBeenCalledTimes(1);
      const [input, key] = redeem.mock.calls[0]!;
      expect(input).toMatchObject({
        cardToken: "mock-reward",
        rewardUnlockId: "unlock-1",
        branchId: "branch-1",
      });
      expect(key).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    });

    it("keeps a reward reachable when only stamping is blocked by a cooldown", async () => {
      validate.mockResolvedValue({
        outcome: "REJECTED",
        reason: "COOLDOWN_ACTIVE",
        message: MESSAGE,
        retryAfterSeconds: 60,
        customer: { firstName: "Abebe" },
        progress,
        replayed: false,
      });
      const user = setup();
      await enterCode(user, "mock-reward");
      expect(await screen.findByTestId("reward-section")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add stamp" })).not.toBeInTheDocument();
      expect(screen.getByText("Too soon for another stamp")).toBeInTheDocument();
    });

    it("does not retry a redemption by itself, and a check-again reuses the same key", async () => {
      redeem.mockRejectedValueOnce(
        new ApiError({ kind: "network", code: "NETWORK_ERROR", message: "x" }),
      );
      const user = setup();
      await enterCode(user, "mock-reward");
      await user.click(await screen.findByRole("button", { name: "Redeem reward" }));
      await user.click(
        within(await screen.findByRole("dialog")).getByRole("button", { name: "Redeem reward" }),
      );

      const problem = await screen.findByTestId("scan-problem");
      expect(
        within(problem).getByText(/could not confirm whether the reward was given/),
      ).toBeInTheDocument();
      expect(redeem).toHaveBeenCalledTimes(1);
      const firstKey = redeem.mock.calls[0]![1];

      redeem.mockResolvedValueOnce({
        outcome: "REDEEMED",
        reason: null,
        message: MESSAGE,
        reward,
        replayed: true,
      });
      await user.click(within(problem).getByRole("button", { name: "Check again" }));
      expect(await screen.findByTestId("redeem-success")).toBeInTheDocument();
      expect(redeem).toHaveBeenCalledTimes(2);
      expect(redeem.mock.calls[1]![1]).toBe(firstKey);
      expect(screen.getByText("This stamp had already been recorded.")).toBeInTheDocument();
    });
  });

  describe("failures", () => {
    it("never shows success when the connection is lost mid-stamp, and says the result is unknown", async () => {
      stamp.mockRejectedValueOnce(
        new ApiError({ kind: "network", code: "NETWORK_ERROR", message: "x" }),
      );
      const user = setup();
      await enterCode(user);
      await user.click(await screen.findByRole("button", { name: "Add stamp" }));
      const problem = await screen.findByTestId("scan-problem");
      expect(
        within(problem).getByText(/could not confirm whether the stamp was added/),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("scan-success")).not.toBeInTheDocument();
      expect(stamp).toHaveBeenCalledTimes(1);
    });

    it("re-sends the same idempotency key when checking again", async () => {
      stamp.mockRejectedValueOnce(
        new ApiError({ kind: "unavailable", code: "HTTP_503", message: "x" }),
      );
      stamp.mockResolvedValueOnce({ ...stamped, replayed: true });
      const user = setup();
      await enterCode(user);
      await user.click(await screen.findByRole("button", { name: "Add stamp" }));
      await user.click(await screen.findByRole("button", { name: "Check again" }));
      expect(await screen.findByTestId("scan-success")).toBeInTheDocument();
      expect(stamp).toHaveBeenCalledTimes(2);
      expect(stamp.mock.calls[1]![1]).toBe(stamp.mock.calls[0]![1]);
    });

    it("shows permission denied without offering a retry", async () => {
      validate.mockRejectedValue(
        new ApiError({ kind: "forbidden", code: "FORBIDDEN", message: "x", status: 403 }),
      );
      lookupRewards.mockRejectedValue(
        new ApiError({ kind: "forbidden", code: "FORBIDDEN", message: "x", status: 403 }),
      );
      const user = setup();
      await enterCode(user);
      const problem = await screen.findByTestId("scan-problem");
      expect(problem).toHaveAttribute("data-kind", "permission");
      expect(within(problem).getByText("You are not allowed to do this")).toBeInTheDocument();
      expect(
        within(problem).queryByRole("button", { name: "Check again" }),
      ).not.toBeInTheDocument();
    });

    it("shows server unavailable when the check cannot be answered", async () => {
      validate.mockRejectedValue(
        new ApiError({ kind: "unavailable", code: "HTTP_503", message: "x", status: 503 }),
      );
      const user = setup();
      await enterCode(user);
      const problem = await screen.findByTestId("scan-problem");
      expect(problem).toHaveAttribute("data-kind", "unavailable");
      expect(within(problem).getByText("Service unavailable")).toBeInTheDocument();
    });
  });

  describe("offline", () => {
    it("shows the state clearly and disables every way of starting a scan", async () => {
      setup();
      setOnline(false);
      expect(screen.getByTestId("connection")).toHaveTextContent("Offline");
      expect(screen.getByText("No internet connection")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: /^Card code/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Look up" })).toBeDisabled();
    });

    it("disables Add stamp offline, so nothing can be queued", async () => {
      const user = setup();
      await enterCode(user);
      const add = await screen.findByRole("button", { name: "Add stamp" });
      setOnline(false);
      expect(add).toBeDisabled();
      expect(stamp).not.toHaveBeenCalled();
    });

    it("comes back to normal when the connection returns", () => {
      setup();
      setOnline(false);
      setOnline(true);
      expect(screen.getByTestId("connection")).toHaveTextContent("Online");
      expect(screen.getByRole("textbox", { name: /^Card code/ })).toBeEnabled();
    });
  });

  describe("recent activity and manual lookup", () => {
    it("lists what this phone did, with first names only", async () => {
      stamp.mockResolvedValue(stamped);
      const user = setup();
      await enterCode(user);
      await user.click(await screen.findByRole("button", { name: "Add stamp" }));
      await user.click(await screen.findByRole("button", { name: "Scan next card" }));
      const list = await screen.findByTestId("recent-list");
      expect(within(list).getByText("Stamp added: Abebe")).toBeInTheDocument();
      expect(list.textContent).not.toContain("mock-ok-1-4567");
    });

    it("looks a member up by phone, read-only, and asks for the card", async () => {
      search.mockResolvedValue({
        items: [
          {
            id: "c1",
            firstName: "Abebe",
            phone: "+2519•••••111",
            phoneMasked: true,
            preferredLanguage: "EN",
            joinedAt: "x",
            marketingConsent: false,
            memberships: [{ id: "m1", programId: "p1", status: "ACTIVE", joinedAt: "x" }],
          },
        ],
        nextCursor: null,
      });
      const user = setup();
      await user.click(screen.getByRole("tab", { name: "Phone number" }));
      await user.type(screen.getByRole("textbox", { name: /Phone number/ }), "0911000111");
      await user.click(screen.getAllByRole("button", { name: "Look up" })[0]!);
      const results = await screen.findByTestId("lookup-results");
      expect(within(results).getByText("Abebe")).toBeInTheDocument();
      expect(within(results).getByText("+2519•••••111")).toBeInTheDocument();
      expect(within(results).getByText(/scan its code/)).toBeInTheDocument();
      expect(search).toHaveBeenCalledWith({ q: "+251911000111" });
      expect(stamp).not.toHaveBeenCalled();
    });

    it("asks for the complete number and reports no match", async () => {
      search.mockResolvedValue({ items: [], nextCursor: null });
      const user = setup();
      await user.click(screen.getByRole("tab", { name: "Phone number" }));
      await user.type(screen.getByRole("textbox", { name: /Phone number/ }), "0911");
      await user.click(screen.getAllByRole("button", { name: "Look up" })[0]!);
      expect(await screen.findByText("Enter the complete phone number.")).toBeInTheDocument();
      expect(search).not.toHaveBeenCalled();

      await user.clear(screen.getByRole("textbox", { name: /Phone number/ }));
      await user.type(screen.getByRole("textbox", { name: /Phone number/ }), "0911999999");
      await user.click(screen.getAllByRole("button", { name: "Look up" })[0]!);
      expect(await screen.findByText("No member found with that number.")).toBeInTheDocument();
    });
  });
});
