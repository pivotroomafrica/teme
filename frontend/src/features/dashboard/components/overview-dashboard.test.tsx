import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import type { AnalyticsOverview } from "@/lib/api/contract";
import { ApiError } from "@/lib/errors/api-error";
import { I18nProvider } from "@/lib/i18n/client";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";
import {
  MOCK_DEFINITIONS,
  auditFor,
  branchesFor,
  monthlyReturningFor,
  overviewFor,
  resolveMockRange,
  walletFor,
  type RangeResult,
} from "@/mocks/analytics-data";
import { OverviewDashboard } from "./overview-dashboard";

const overview = vi.fn();
const monthlyReturning = vi.fn();
const branches = vi.fn();
const wallet = vi.fn();
const definitions = vi.fn();
const auditList = vi.fn();
const replace = vi.fn();
let search = "";

vi.mock("@/lib/api/browser", () => ({
  getBrowserApi: () => ({
    analytics: { overview, monthlyReturning, branches, wallet, definitions },
    audit: { list: auditList },
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/en/dashboard",
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));

const TODAY = "2026-10-08";
const NOW = Date.parse("2026-10-08T09:00:00Z");
const rangeOf = (query: Record<string, unknown>) =>
  resolveMockRange(query, NOW) as Extract<RangeResult, { ok: true }>;
const last30 = rangeOf({ from: "2026-09-09", to: "2026-10-08" });

function useBackendDefaults() {
  overview.mockImplementation((range: { from: string; to: string }) =>
    Promise.resolve(overviewFor(rangeOf(range))),
  );
  monthlyReturning.mockImplementation(() =>
    Promise.resolve(monthlyReturningFor({ months: 6 }, NOW)),
  );
  branches.mockImplementation((range: { from: string; to: string }) =>
    Promise.resolve(branchesFor(rangeOf(range))),
  );
  wallet.mockImplementation((range: { from: string; to: string }) =>
    Promise.resolve(walletFor(rangeOf(range))),
  );
  definitions.mockResolvedValue(MOCK_DEFINITIONS);
  auditList.mockResolvedValue(auditFor(8, NOW));
}

function show(
  options: {
    locale?: "en" | "am";
    analytics?: boolean;
    audit?: boolean;
    timeZone?: string;
  } = {},
) {
  const locale = options.locale ?? "en";
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale} messages={locale === "en" ? en : am}>
        <ToastProvider>
          <OverviewDashboard
            timeZone={options.timeZone ?? "Africa/Addis_Ababa"}
            today={TODAY}
            canReadAnalytics={options.analytics ?? true}
            canReadAudit={options.audit ?? true}
          />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return user;
}

const card = (name: string) => screen.getByRole("article", { name });

beforeEach(() => {
  for (const mock of [
    overview,
    monthlyReturning,
    branches,
    wallet,
    definitions,
    auditList,
    replace,
  ]) {
    mock.mockReset();
  }
  search = "";
  useBackendDefaults();
});

describe("requests", () => {
  it("asks the backend for each section exactly once", async () => {
    show();
    await screen.findByTestId("events-list");
    await waitFor(() => expect(wallet).toHaveBeenCalled());
    for (const call of [overview, monthlyReturning, branches, wallet, definitions, auditList]) {
      expect(call).toHaveBeenCalledTimes(1);
    }
  });
});

describe("OverviewDashboard figures", () => {
  it("shows every headline metric exactly as the backend reported it", async () => {
    show();
    const expected = overviewFor(last30) as AnalyticsOverview;
    const format = new Intl.NumberFormat("en-ET");
    await waitFor(() =>
      expect(card("New members")).toHaveTextContent(format.format(expected.newMembers)),
    );
    expect(card("Active members")).toHaveTextContent(format.format(expected.activeMembers));
    expect(card("Stamps issued")).toHaveTextContent(format.format(expected.stampsIssued.count));
    expect(card("Rewards unlocked")).toHaveTextContent(format.format(expected.rewardsUnlocked));
    expect(card("Rewards redeemed")).toHaveTextContent(format.format(expected.rewardsRedeemed));
    expect(card("Redemption rate")).toHaveTextContent("80%");
    const northStar = card("Monthly Returning Loyalty Customers");
    const series = monthlyReturningFor({ months: 6 }, NOW);
    if ("error" in series) throw new Error("fixture");
    await waitFor(() => expect(northStar).toHaveTextContent(String(series.value)));
    expect(northStar).toHaveTextContent("October 2026 is not over yet");
  });

  it("asks the backend for the chosen days, and for nothing else to be worked out in the browser", async () => {
    show();
    await waitFor(() => expect(overview).toHaveBeenCalled());
    expect(overview.mock.calls[0]![0]).toEqual({ from: "2026-09-09", to: "2026-10-08" });
    expect(branches.mock.calls[0]![0]).toEqual({ from: "2026-09-09", to: "2026-10-08" });
    expect(wallet.mock.calls[0]![0]).toEqual({ from: "2026-09-09", to: "2026-10-08" });
  });

  it("never shows a missing ratio as 0%", async () => {
    overview.mockResolvedValue({
      ...overviewFor(last30),
      rewardsUnlocked: 0,
      rewardsRedeemed: 0,
      redemptionRate: null,
    });
    show();
    await waitFor(() => expect(card("Redemption rate")).toHaveTextContent("—"));
    expect(card("Redemption rate")).toHaveTextContent("No rewards were unlocked in this period.");
    expect(card("Redemption rate")).not.toHaveTextContent("0%");
  });

  it("shows a ratio above 100% as the backend defined it", async () => {
    overview.mockResolvedValue({ ...overviewFor(last30), redemptionRate: 1.25 });
    show();
    await waitFor(() => expect(card("Redemption rate")).toHaveTextContent("125%"));
  });

  it("mentions stamps that were later reversed", async () => {
    show();
    await waitFor(() => expect(card("Stamps issued")).toHaveTextContent("later reversed"));
  });

  it("offers the backend's own definitions", async () => {
    const user = show();
    const details = await screen.findByTestId("definitions");
    await user.click(within(details).getByText("What do these numbers mean?"));
    expect(within(details).getByText(/divided by rewards unlocked/)).toBeVisible();
  });

  it("has no money anywhere: no revenue, sales, order value, payments, billing or subscriptions", async () => {
    show();
    await waitFor(() => expect(card("New members")).toHaveTextContent(/\d/));
    await screen.findByTestId("events-list");
    expect(document.body.textContent).not.toMatch(
      /revenue|sales|order value|average order|payment|billing|subscription|price|\bETB\b|\bbirr\b|\$/i,
    );
  });
});

describe("loading, empty, partial and error states", () => {
  it("shows loading placeholders for each part while it waits, then replaces them", async () => {
    let finish: (value: unknown) => void = () => undefined;
    overview.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    show();
    expect(card("New members")).toHaveAttribute("aria-busy", "true");
    finish(overviewFor(last30));
    await waitFor(() => expect(card("New members")).not.toHaveAttribute("aria-busy"));
  });

  it("explains an empty period instead of showing a blank page", async () => {
    overview.mockResolvedValue(overviewFor(rangeOf({ from: "2025-01-01", to: "2025-01-31" })));
    branches.mockResolvedValue(branchesFor(rangeOf({ from: "2025-01-01", to: "2025-01-31" })));
    wallet.mockResolvedValue(walletFor(rangeOf({ from: "2025-01-01", to: "2025-01-31" })));
    show();
    expect(await screen.findByText("No loyalty activity in this period yet.")).toBeInTheDocument();
    expect(await screen.findByText("No branch activity in this period.")).toBeInTheDocument();
    expect(await screen.findByText("No wallet activity yet.")).toBeInTheDocument();
    expect(card("New members")).toHaveTextContent("0");
  });

  it("keeps the rest of the page when one section fails, and recovers on retry", async () => {
    branches.mockRejectedValueOnce(
      new ApiError({ kind: "unavailable", code: "HTTP_503", message: "x", requestId: "req-42" }),
    );
    const user = show();
    const section = await screen.findByTestId("section-branches");
    await waitFor(() => expect(section).toHaveAttribute("data-state", "error"));
    expect(within(section).getByText("We could not load this section.")).toBeInTheDocument();
    expect(within(section).getByText("req-42")).toBeInTheDocument();
    expect(screen.getByText("Some information could not be loaded")).toBeInTheDocument();
    // Everything else is still there.
    await waitFor(() => expect(card("New members")).toHaveTextContent(/\d/));
    expect(await screen.findByTestId("events-list")).toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(section).toHaveAttribute("data-state", "ready"));
    expect(screen.queryByText("Some information could not be loaded")).not.toBeInTheDocument();
  });

  it("shows an error for the headline figures when the overview fails, without inventing numbers", async () => {
    overview.mockRejectedValue(new ApiError({ kind: "server", code: "INTERNAL", message: "x" }));
    show();
    await waitFor(() =>
      expect(screen.getAllByText("We could not load this section.").length).toBeGreaterThan(0),
    );
    expect(card("New members")).toHaveTextContent("—");
  });
});

describe("permissions", () => {
  it("asks for no statistics without analytics:read, and says why", async () => {
    show({ analytics: false });
    expect(screen.getByText(/does not include loyalty statistics/)).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "New members" })).not.toBeInTheDocument();
    await waitFor(() => expect(auditList).toHaveBeenCalled());
    for (const mock of [overview, monthlyReturning, branches, wallet, definitions]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it("asks for no activity history without audit:read", async () => {
    show({ audit: false });
    expect(screen.getByText(/does not include the activity history/)).toBeInTheDocument();
    await waitFor(() => expect(overview).toHaveBeenCalled());
    expect(auditList).not.toHaveBeenCalled();
    expect(screen.queryByText("Recent operational events")).not.toBeInTheDocument();
  });
});

describe("date range and time zone", () => {
  it("reads the range from the page address", async () => {
    search = "range=last7";
    show();
    await waitFor(() => expect(overview).toHaveBeenCalled());
    expect(overview.mock.calls[0]![0]).toEqual({ from: "2026-10-02", to: "2026-10-08" });
    expect(screen.getByTestId("range-summary")).toHaveTextContent("Oct 2, 2026 to Oct 8, 2026");
  });

  it("puts a chosen period in the address so it can be shared and survives a reload", async () => {
    const user = show();
    await user.selectOptions(screen.getByRole("combobox", { name: "Period" }), "last7");
    expect(replace).toHaveBeenCalledWith("/en/dashboard?range=last7", { scroll: false });
    await user.selectOptions(screen.getByRole("combobox", { name: "Period" }), "last30");
    expect(replace).toHaveBeenLastCalledWith("/en/dashboard", { scroll: false });
  });

  it("checks custom dates before anything is sent", async () => {
    const user = show();
    await user.selectOptions(screen.getByRole("combobox", { name: "Period" }), "custom");
    const from = screen.getByLabelText("From");
    const to = screen.getByLabelText("To");
    await user.clear(from);
    await user.type(from, "2026-10-09");
    await user.clear(to);
    await user.type(to, "2026-10-01");
    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(
      await screen.findByText("The start date must not be after the end date."),
    ).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();

    await user.clear(from);
    await user.type(from, "2024-01-01");
    await user.clear(to);
    await user.type(to, "2026-10-01");
    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(await screen.findByText("Choose at most 366 days.")).toBeInTheDocument();

    await user.clear(from);
    await user.type(from, "2026-08-01");
    await user.clear(to);
    await user.type(to, "2026-08-31");
    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(replace).toHaveBeenCalledWith("/en/dashboard?from=2026-08-01&to=2026-08-31", {
      scroll: false,
    });
  });

  it("states the business time zone and shows event times in it", async () => {
    // 21:30 UTC on 8 October is already 9 October in Addis Ababa (UTC+3), but still the 8th in Los Angeles.
    auditList.mockResolvedValue({
      items: [
        {
          id: "e1",
          occurredAt: "2026-10-08T21:30:00Z",
          action: "stamp.issued",
          actor: { type: "USER", userId: "u", displayName: "Selam Cashier" },
          branchId: null,
          targetType: null,
          targetId: null,
        },
      ],
      nextCursor: null,
    });
    show({ timeZone: "Africa/Addis_Ababa" });
    expect(screen.getByTestId("range-summary")).toHaveTextContent("time zone: Africa/Addis_Ababa");
    expect(await screen.findByText(/Oct 9, 2026/)).toBeInTheDocument();
  });

  it("uses another business time zone when the business has one", async () => {
    auditList.mockResolvedValue({
      items: [
        {
          id: "e1",
          occurredAt: "2026-10-08T21:30:00Z",
          action: "stamp.issued",
          actor: { type: "USER", userId: "u", displayName: "Selam Cashier" },
          branchId: null,
          targetType: null,
          targetId: null,
        },
      ],
      nextCursor: null,
    });
    show({ timeZone: "America/Los_Angeles" });
    expect(await screen.findByText(/Oct 8, 2026/)).toBeInTheDocument();
  });
});

describe("charts have text alternatives", () => {
  it("describes the chart for screen readers and offers the same numbers as a table", async () => {
    const user = show();
    const chart = await screen.findByRole("img", {
      name: /Bar chart of returning loyalty customers/,
    });
    expect(chart).toHaveAccessibleDescription(/October 2026 \(so far\): \d+/);
    expect(chart).toHaveAccessibleDescription(/May 2026: \d+/);

    const section = screen.getByTestId("section-trend");
    await user.click(within(section).getByRole("button", { name: "Show as a table" }));
    const table = within(section).getByRole("table", { name: "Returning customers by month" });
    expect(within(table).getAllByRole("row")).toHaveLength(7); // header + six months
    expect(within(table).getByText("October 2026 (so far)")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Hide the table" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("prints each bar's value, so the picture is never the only source", async () => {
    show();
    const bars = await screen.findAllByTestId("bar");
    expect(bars).toHaveLength(6);
    for (const bar of bars) expect(bar.textContent).toMatch(/\d/);
  });

  it("gives the branch table a real caption and row headers", async () => {
    show();
    const table = await screen.findByRole("table", { name: /Branch activity in this period/ });
    expect(within(table).getByRole("rowheader", { name: "Bole" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Stamps" })).toBeInTheDocument();
  });
});

describe("recent events and wallet health", () => {
  it("translates known events and shows unknown ones honestly", async () => {
    show();
    const list = await screen.findByTestId("events-list");
    expect(within(list).getByText("Stamp added")).toBeInTheDocument();
    expect(within(list).getByText("Team role changed")).toBeInTheDocument();
    expect(within(list).getByText("Other activity (some.future_action)")).toBeInTheDocument();
    expect(within(list).getAllByText(/System/).length).toBeGreaterThan(0);
    // No customer details: only an action, who did it, and when.
    expect(list.textContent).not.toMatch(/\+251|phone|card/i);
  });

  it("reports wallet update health with the backend's own counts", async () => {
    show();
    const section = await screen.findByTestId("section-wallet");
    await waitFor(() => expect(within(section).getByTestId("wallet-rate")).toHaveTextContent("%"));
    expect(within(section).getByText("2 failed after all retries")).toBeInTheDocument();
    expect(
      within(section).getByText(/Some updates failed after all retries, so a customer/),
    ).toBeInTheDocument();
    expect(within(section).getByText("Apple Wallet")).toBeInTheDocument();
  });

  it("has no failure warning when every update succeeded", async () => {
    wallet.mockResolvedValue({
      ...walletFor(last30),
      updates: { succeeded: 10, failed: 0, stillQueued: 0, succeededAfterRetry: 0, successRate: 1 },
    });
    show();
    const section = await screen.findByTestId("section-wallet");
    await waitFor(() =>
      expect(within(section).getByTestId("wallet-rate")).toHaveTextContent("100%"),
    );
    expect(within(section).queryByText(/Some updates failed/)).not.toBeInTheDocument();
  });
});

describe("Amharic", () => {
  it("shows the Amharic labels and the business's own Amharic branch names", async () => {
    show({ locale: "am" });
    expect(await screen.findByText("በየወሩ የሚመለሱ የታማኝነት ደንበኞች")).toBeInTheDocument();
    expect(await screen.findByRole("rowheader", { name: "ቦሌ" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "አዲስ አባላት" })).toBeInTheDocument();
  });
});
