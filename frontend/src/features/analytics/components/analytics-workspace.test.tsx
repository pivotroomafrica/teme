import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/errors/api-error";
import { I18nProvider } from "@/lib/i18n/client";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";
import {
  MOCK_DEFINITIONS,
  branchesFor,
  cohortsFor,
  monthlyReturningFor,
  overviewFor,
  resolveMockRange,
  staffFor,
  walletFor,
  type RangeResult,
} from "@/mocks/analytics-data";
import { AnalyticsWorkspace } from "./analytics-workspace";

const overview = vi.fn();
const monthlyReturning = vi.fn();
const branches = vi.fn();
const staff = vi.fn();
const cohorts = vi.fn();
const wallet = vi.fn();
const definitions = vi.fn();
const replace = vi.fn();
let search = "";

vi.mock("@/lib/api/browser", () => ({
  getBrowserApi: () => ({
    analytics: { overview, monthlyReturning, branches, staff, cohorts, wallet, definitions },
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/en/dashboard/analytics",
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));

const TODAY = "2026-10-08";
const NOW = Date.parse("2026-10-08T09:00:00Z");
const rangeOf = (query: Record<string, unknown>) =>
  resolveMockRange(query, NOW) as Extract<RangeResult, { ok: true }>;
type Q = { from: string; to: string };
const failure = (status = 503) =>
  new ApiError({
    kind: "unavailable",
    code: "UNAVAILABLE",
    status,
    message: "backend english text",
  });

function backendDefaults() {
  overview.mockImplementation((r: Q) => Promise.resolve(overviewFor(rangeOf(r))));
  monthlyReturning.mockImplementation((input: { months?: number }) =>
    Promise.resolve(monthlyReturningFor({ months: input.months ?? 6 }, NOW)),
  );
  branches.mockImplementation((r: Q) => Promise.resolve(branchesFor(rangeOf(r))));
  staff.mockImplementation((r: Q, input: { limit?: number; cursor?: string }) =>
    Promise.resolve(staffFor(rangeOf(r), input)),
  );
  cohorts.mockImplementation((input: { cohorts?: number }) =>
    Promise.resolve(cohortsFor({ cohorts: input.cohorts ?? 6 }, NOW)),
  );
  wallet.mockImplementation((r: Q) => Promise.resolve(walletFor(rangeOf(r))));
  definitions.mockResolvedValue(MOCK_DEFINITIONS);
}

function show(options: { locale?: "en" | "am"; allowed?: boolean; zone?: string } = {}) {
  const locale = options.locale ?? "en";
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider locale={locale} messages={locale === "en" ? en : am}>
        <AnalyticsWorkspace
          timeZone={options.zone ?? "Africa/Addis_Ababa"}
          today={TODAY}
          canReadAnalytics={options.allowed ?? true}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  search = "";
  backendDefaults();
});

describe("requests", () => {
  it("asks the backend for each section exactly once, however many components show it", async () => {
    show();
    await screen.findByRole("table", { name: "Retention cohorts" });
    await screen.findByRole("table", { name: "Staff activity" });
    await waitFor(() => expect(wallet).toHaveBeenCalled());
    for (const call of [
      overview,
      monthlyReturning,
      branches,
      staff,
      cohorts,
      wallet,
      definitions,
    ]) {
      expect(call).toHaveBeenCalledTimes(1);
    }
  });
});

describe("date ranges", () => {
  it("asks the backend for the last 30 days by default, in calendar days", async () => {
    show();
    await screen.findByTestId("section-headline");
    expect(overview).toHaveBeenCalledWith({ from: "2026-09-09", to: TODAY }, expect.anything());
    expect(screen.getByTestId("range-summary")).toHaveTextContent("Africa/Addis_Ababa");
  });

  it("follows the range in the address, and the same range goes to every section", async () => {
    search = "from=2026-08-01&to=2026-08-31";
    show();
    await screen.findByTestId("section-headline");
    const expected = { from: "2026-08-01", to: "2026-08-31" };
    await waitFor(() => {
      for (const call of [overview, branches, staff, wallet]) {
        expect(
          call.mock.calls.some(
            (args) => args[0].from === expected.from && args[0].to === expected.to,
          ),
        ).toBe(true);
      }
    });
  });

  it("uses this month's preset from the address", async () => {
    search = "range=thisMonth";
    show();
    await waitFor(() =>
      expect(overview).toHaveBeenCalledWith({ from: "2026-10-01", to: TODAY }, expect.anything()),
    );
  });

  it("falls back to the default for an address that is not a real range", async () => {
    search = "from=2026-02-30&to=2026-03-02";
    show();
    await waitFor(() =>
      expect(overview).toHaveBeenCalledWith({ from: "2026-09-09", to: TODAY }, expect.anything()),
    );
  });

  it("changes the address when another period is chosen", async () => {
    const user = show();
    await screen.findByTestId("section-headline");
    await user.selectOptions(screen.getByLabelText("Period"), "Last 7 days");
    expect(replace).toHaveBeenCalledWith("/en/dashboard/analytics?range=last7", { scroll: false });
  });

  it("explains a range the backend would refuse, before sending anything", async () => {
    const user = show();
    await screen.findByTestId("section-headline");
    await user.selectOptions(screen.getByLabelText("Period"), "Choose dates");
    await user.clear(screen.getByLabelText("From"));
    await user.type(screen.getByLabelText("From"), "2025-01-01");
    await user.clear(screen.getByLabelText("To"));
    await user.type(screen.getByLabelText("To"), "2026-10-01");
    await user.click(screen.getByRole("button", { name: /^Show$/ }));
    expect(await screen.findByText(/366/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("states the business time zone it reads months and days in", async () => {
    show({ zone: "Africa/Nairobi" });
    expect(await screen.findByTestId("range-summary")).toHaveTextContent("Africa/Nairobi");
  });
});

describe("what is shown", () => {
  it("puts the north-star number first and shows the backend's numbers unchanged", async () => {
    show();
    const headline = await screen.findByTestId("section-headline");
    await waitFor(() => expect(headline).toHaveAttribute("data-state", "ready"));
    const northStar = monthlyReturningFor({ months: 6 }, NOW);
    expect("value" in northStar && northStar.value).toBeGreaterThan(0);
    const cards = screen.getAllByRole("article");
    expect(within(cards[0]!).getByText("Monthly Returning Loyalty Customers")).toBeInTheDocument();
    const o = overviewFor(rangeOf({ from: "2026-09-09", to: TODAY }));
    expect(
      within(headline).getByText(new Intl.NumberFormat("en").format(o.newMembers)),
    ).toBeInTheDocument();
    expect(within(headline).getByText("Average visits per active member")).toBeInTheDocument();
    expect(within(screen.getByTestId("time-between")).getByText("72 hours")).toBeInTheDocument();
    expect(within(screen.getByTestId("time-between")).getByText("240 hours")).toBeInTheDocument();
  });

  it("shows a dash, never 0%, for a ratio the backend could not compute", async () => {
    overview.mockResolvedValue({
      ...overviewFor(rangeOf({ from: "2026-09-09", to: TODAY })),
      rewardsUnlocked: 0,
      redemptionRate: null,
      averageVisitsPerActiveMember: null,
    });
    show();
    const headline = await screen.findByTestId("section-headline");
    await waitFor(() => expect(headline).toHaveAttribute("data-state", "ready"));
    const card = within(headline).getByText("Redemption rate").closest("article")!;
    expect(within(card).getByText("—")).toBeInTheDocument();
    expect(within(card).queryByText("0%")).not.toBeInTheDocument();
    const avg = within(headline).getByText("Average visits per active member").closest("article")!;
    expect(within(avg).getByText("—")).toBeInTheDocument();
  });

  it("shows the retention cohorts exactly as the backend gave them", async () => {
    show();
    const table = await screen.findByRole("table", { name: "Retention cohorts" });
    const data = cohortsFor({ cohorts: 6 }, NOW) as Exclude<
      ReturnType<typeof cohortsFor>,
      { error: string }
    >;
    const first = data.cohorts[0]!;
    const row = within(table).getAllByRole("row")[1]!;
    for (const cell of first.retention) {
      expect(
        within(row).getAllByText(
          new Intl.NumberFormat("en", { style: "percent" }).format(cell.rate!),
        ).length,
      ).toBeGreaterThan(0);
    }
    expect(within(table).getByRole("columnheader", { name: "Month 0" })).toBeInTheDocument();
  });

  it("pages staff activity ten at a time with a show-more button", async () => {
    const user = show();
    const table = await screen.findByRole("table", { name: "Staff activity" });
    expect(within(table).getAllByRole("row")).toHaveLength(11);
    await user.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(13));
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
    expect(staff).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ cursor: "10" }),
      expect.anything(),
    );
    expect(within(table).getByText(/deactivated/)).toBeInTheDocument();
  });

  it("has no money anywhere and offers no export", async () => {
    show();
    await screen.findByTestId("section-headline");
    await screen.findByRole("table", { name: "Staff activity" });
    // Everything except the page's own sentence saying that it has no money figures.
    const text = document.body.textContent!.replace(en.analytics.noMoney, "");
    expect(text).not.toMatch(/\bETB\b|\bbirr\b|revenue|sales|\$|€|payment|billing/i);
    expect(screen.queryByRole("button", { name: /export|download|csv/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Exports are not offered yet/)).toBeInTheDocument();
  });

  it("lists the backend's own metric definitions", async () => {
    const user = show();
    const details = await screen.findByTestId("definitions");
    await user.click(within(details).getByText("What do these numbers mean?"));
    expect(within(details).getByText("New members")).toBeVisible();
  });
});

describe("empty data", () => {
  beforeEach(() => {
    search = "from=2025-01-01&to=2025-01-31";
  });

  it("explains an empty period and each empty section, with no fake zeros in ratios", async () => {
    show();
    expect(await screen.findByText(/Nothing happened in this period/)).toBeInTheDocument();
    expect(await screen.findByText("No branch activity in this period.")).toBeInTheDocument();
    expect(await screen.findByText("No staff activity in this period.")).toBeInTheDocument();
    expect(await screen.findByText("No active cards yet.")).toBeInTheDocument();
    expect(screen.getByTestId("time-between")).toHaveTextContent("Not enough return visits");
  });

  it("explains a trend with no visits at all", async () => {
    monthlyReturning.mockResolvedValue({
      ...(monthlyReturningFor({ months: 6 }, NOW) as object),
      value: 0,
      series: [
        {
          month: "2026-10",
          returningCustomers: 0,
          activeMembers: 0,
          returningShare: null,
          partial: true,
        },
      ],
    });
    show();
    expect(await screen.findByText("No visits in these months yet.")).toBeInTheDocument();
  });

  it("explains cohorts with no new members", async () => {
    cohorts.mockResolvedValue({
      timeZone: "Africa/Addis_Ababa",
      programId: null,
      cohorts: [
        {
          cohortMonth: "2026-10",
          size: 0,
          retention: [{ monthOffset: 0, retained: 0, rate: null }],
        },
      ],
    });
    show();
    expect(await screen.findByText("No new members in these months yet.")).toBeInTheDocument();
  });
});

describe("partial failure", () => {
  it("keeps every other section when one fails, and retries only that one", async () => {
    staff.mockRejectedValueOnce(failure());
    const user = show();
    expect(await screen.findByText(/Some information could not be loaded/)).toBeInTheDocument();
    const section = await screen.findByTestId("section-staff");
    await waitFor(() => expect(section).toHaveAttribute("data-state", "error"));
    expect(section).not.toHaveTextContent("backend english text");
    expect(screen.getByTestId("section-headline")).toHaveAttribute("data-state", "ready");
    expect(screen.getByTestId("section-cohorts")).toHaveAttribute("data-state", "ready");
    expect(screen.getByTestId("section-wallet")).toHaveAttribute("data-state", "ready");

    const calls = { overview: overview.mock.calls.length, cohorts: cohorts.mock.calls.length };
    await user.click(within(section).getByRole("button", { name: /Try again|Retry/ }));
    await waitFor(() => expect(section).toHaveAttribute("data-state", "ready"));
    expect(overview.mock.calls.length).toBe(calls.overview);
    expect(cohorts.mock.calls.length).toBe(calls.cohorts);
  });

  it("still shows the north star when the supporting numbers fail", async () => {
    overview.mockRejectedValue(failure());
    wallet.mockRejectedValue(failure());
    show();
    const cards = await screen.findAllByRole("article");
    expect(cards[0]).toHaveTextContent("Monthly Returning Loyalty Customers");
    await waitFor(() =>
      expect(screen.getByTestId("section-headline")).toHaveAttribute("data-state", "error"),
    );
    expect(screen.getByTestId("section-wallet")).toHaveAttribute("data-state", "error");
    expect(screen.getByTestId("section-branches")).toHaveAttribute("data-state", "ready");
  });

  it("shows loading placeholders before data arrives", async () => {
    overview.mockReturnValue(new Promise(() => {}));
    show();
    expect(screen.getByTestId("section-headline")).toHaveAttribute("data-state", "loading");
  });

  it("makes no requests and says why without analytics permission", () => {
    show({ allowed: false });
    expect(screen.getByText(en.dashboard.noAnalyticsAccess)).toBeInTheDocument();
    for (const call of [overview, monthlyReturning, branches, staff, cohorts, wallet]) {
      expect(call).not.toHaveBeenCalled();
    }
  });
});

describe("accessible charts", () => {
  it("describes every chart for screen readers with its values", async () => {
    show();
    const charts = await screen.findAllByRole("img");
    const named = (name: string) =>
      charts.find(
        (c) => c.getAttribute("aria-labelledby") && c.querySelector("title")?.textContent === name,
      );
    const trend = named(en.dashboard.trendChart)!;
    const desc = trend.querySelector("desc")!.textContent!;
    expect(desc).toContain(en.dashboard.trendChart);
    const series = (
      monthlyReturningFor({ months: 6 }, NOW) as { series: Array<{ returningCustomers: number }> }
    ).series;
    for (const m of series) expect(desc).toContain(`: ${m.returningCustomers}`);
    expect(desc).toMatch(/so far/);

    const branch = charts.find(
      (c) => c.querySelector("title")?.textContent === "Stamps by branch",
    )!;
    expect(branch.querySelector("desc")!.textContent).toMatch(/Bole: \d+; Piassa: \d+/);
    const walletChart = charts.find(
      (c) => c.querySelector("title")?.textContent === "Wallet adoption by provider",
    )!;
    expect(walletChart.querySelector("desc")!.textContent).toMatch(/Apple Wallet: 84 \(20%\)/);
  });

  it("offers a table alternative for every chart, with the same numbers", async () => {
    const user = show();
    await screen.findAllByRole("img");
    const toggles = await screen.findAllByRole("button", { name: "Show as a table" });
    expect(toggles).toHaveLength(3);
    for (const toggle of toggles) {
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
    }
    expect(screen.getByRole("table", { name: /Branch activity/ })).toBeInTheDocument();
    const walletTable = screen.getAllByRole("table", { name: "Wallet adoption by provider" })[0]!;
    expect(within(walletTable).getByText("84 of 420")).toBeInTheDocument();
  });

  it("prints every bar's value so no chart depends on the picture", async () => {
    show();
    const charts = await screen.findAllByRole("img");
    for (const chart of charts) {
      for (const bar of chart.querySelectorAll('[data-testid="bar"]')) {
        expect(bar.textContent!.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("localization", () => {
  it("shows Amharic text without any English fallback for this page's own words", async () => {
    show({ locale: "am" });
    expect(
      await screen.findByRole("table", { name: am.analytics.staffTableLabel }),
    ).toBeInTheDocument();
    expect(screen.getByRole("table", { name: am.analytics.cohortsTableLabel })).toBeInTheDocument();
    expect(screen.getByText(am.analytics.noExport, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("Staff activity")).not.toBeInTheDocument();
  });

  it("describes charts in Amharic too, with the Amharic branch names", async () => {
    show({ locale: "am" });
    const charts = await screen.findAllByRole("img");
    const branch = charts.find(
      (c) => c.querySelector("title")?.textContent === am.analytics.branchChart,
    )!;
    expect(branch.querySelector("desc")!.textContent).toContain("ቦሌ");
  });

  it("keeps digits 0-9 and uses the time zone for month names", async () => {
    show({ locale: "am" });
    const table = await screen.findByRole("table", { name: am.analytics.cohortsTableLabel });
    expect(table.textContent).toMatch(/[0-9]+%/);
    expect(table.textContent).not.toMatch(/[፩-፼]/);
  });
});
