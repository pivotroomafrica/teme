import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import { ApiError } from "@/lib/errors/api-error";
import { I18nProvider } from "@/lib/i18n/client";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";
import { createMockApiFor } from "@/mocks/test-api";
import { MerchantDetail } from "./merchant-detail";
import { MerchantsWorkspace } from "./merchants-workspace";
import { OpsAudit } from "./ops-audit";
import { OpsOverview } from "./ops-overview";
import { PrivacyView } from "./privacy-view";
import { SystemStatus } from "./system-status";
import { WalletHealth } from "./wallet-health";

let current: ReturnType<typeof createMockApiFor>;
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => current.api }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => "/en/operations",
}));

const BAITS = [
  "BAIT-SECRET-TOKEN",
  "BAIT.BEARER.VALUE",
  "BAIT-PASSWORD",
  "BAIT-AUDIT-TOKEN",
  "BaitBrowser",
  "10.0.0.9",
];

function show(
  ui: React.ReactElement,
  locale: "en" | "am" = "en",
  email: "admin@mock.test" | "owner@mock.test" = "admin@mock.test",
) {
  current = createMockApiFor(email);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider locale={locale} messages={locale === "en" ? en : am}>
        <ToastProvider>{ui}</ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
const fail = (status: number, kind: ApiError["kind"], code: string) =>
  new ApiError({ kind, code, status, message: "backend english text" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("merchants", () => {
  const table = () => screen.findByRole("table", { name: "Merchants" });

  it("lists merchants 10 per page with their status, and pages", async () => {
    const user = show(<MerchantsWorkspace />);
    expect(within(await table()).getAllByRole("row")).toHaveLength(11);
    expect(screen.getByText("Showing 1–10 of 12")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("table", { name: "Merchants" })).getAllByRole("row"),
      ).toHaveLength(3),
    );
  });

  it("searches, filters by status, and explains when nothing matches", async () => {
    const user = show(<MerchantsWorkspace />);
    await table();
    await user.selectOptions(screen.getByLabelText("Status"), "Suspended");
    const rows = within(await table())
      .getAllByRole("row")
      .slice(1);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(within(row).getByText("Suspended")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search merchants" }), "zzzz{Enter}");
    expect(
      await screen.findByText("No merchant matches your search or filter."),
    ).toBeInTheDocument();
  });

  it("links to each merchant and shows Amharic names in Amharic", async () => {
    show(<MerchantsWorkspace />, "am");
    const table = await screen.findByRole("table", { name: am.ops.merchantsTableLabel });
    expect(within(table).getByText("ናሙና ካፌ")).toBeInTheDocument();
    const link = within(table).getAllByRole("link")[0]!;
    expect(link).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/am\/operations\/merchants\/[0-9a-f-]+$/),
    );
  });

  it("explains a failed load in words with a retry", async () => {
    current = createMockApiFor("admin@mock.test");
    current.api.operations.merchants = vi
      .fn()
      .mockRejectedValue(fail(503, "unavailable", "UNAVAILABLE"));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nProvider locale="en" messages={en}>
          <MerchantsWorkspace />
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("We could not load merchants")).toBeInTheDocument();
    expect(screen.queryByText(/backend english text/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again|Retry/ })).toBeInTheDocument();
  });
});

describe("merchant detail", () => {
  const ID = "00000000-0000-4000-8000-0000000a0001";

  it("shows organisation data only and states what the service does not offer", async () => {
    show(<MerchantDetail merchantId={ID} />);
    expect(await screen.findByRole("heading", { name: "Sample Cafe" })).toBeInTheDocument();
    expect(screen.getByText(/Organisation details only/)).toBeInTheDocument();
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
    expect(screen.getByText("Approving merchants and changing their status")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /approve|suspend|activate/i }),
    ).not.toBeInTheDocument();
  });

  it("says when the merchant does not exist", async () => {
    show(<MerchantDetail merchantId="00000000-0000-4000-8000-0000000affff" />);
    expect(await screen.findByText("This merchant was not found")).toBeInTheDocument();
  });

  it("asks nothing about the merchant's activity until the person confirms that it is recorded", async () => {
    const user = show(<MerchantDetail merchantId={ID} />);
    await screen.findByRole("heading", { name: "Sample Cafe" });
    const spy = vi.spyOn(current.api.operations, "audit");
    await user.click(screen.getByRole("button", { name: "Show recent activity" }));
    const dialog = await screen.findByRole("dialog", { name: "View this merchant's activity?" });
    expect(
      within(dialog).getByText(/recorded in that merchant's own audit history/),
    ).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(spy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Show recent activity" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "View and record" }),
    );
    const activity = await screen.findByTestId("merchant-activity");
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0]![0]).toMatchObject({ merchantId: ID });
    expect(
      await within(activity).findByRole("table", { name: "Activity history" }),
    ).toBeInTheDocument();
  });

  it("never shows network details or secrets from a merchant's activity", async () => {
    const user = show(<MerchantDetail merchantId={ID} />);
    await screen.findByRole("heading", { name: "Sample Cafe" });
    await user.click(screen.getByRole("button", { name: "Show recent activity" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "View and record" }),
    );
    const activity = await screen.findByTestId("merchant-activity");
    const table = await within(activity).findByRole("table", { name: "Activity history" });
    for (const toggle of within(table).getAllByRole("button", { name: /Show details/ }))
      await user.click(toggle);
    for (const bait of BAITS) expect(document.body.innerHTML).not.toContain(bait);
  });
});

describe("wallet and job health", () => {
  it("shows job counts and the jobs that gave up, with credentials hidden", async () => {
    show(<WalletHealth />);
    const table = await screen.findByRole("table", { name: "Jobs that gave up" });
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(screen.getByTestId("jobs-DEAD")).toHaveTextContent("4");
    expect(screen.getByTestId("jobs-COMPLETED")).toHaveTextContent("240");
    expect(within(table).getAllByText("Wallet card update").length).toBeGreaterThan(0);
    expect(within(table).getByText(/Timeout after 5 attempts/)).toBeInTheDocument();
    for (const bait of BAITS) expect(document.body.innerHTML).not.toContain(bait);
    expect(screen.getByText(/credentials are hidden/)).toBeInTheDocument();
  });

  it("sends nothing until the retry is confirmed, then queues the job again and refreshes", async () => {
    const user = show(<WalletHealth />);
    const table = await screen.findByRole("table", { name: "Jobs that gave up" });
    const spy = vi.spyOn(current.api.operations, "requeueDeadJob");
    await user.click(within(table).getAllByRole("button", { name: /Try again/ })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Try this job again?" });
    expect(within(dialog).getByText(/recorded in the audit history/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(spy).not.toHaveBeenCalled();

    await user.click(within(table).getAllByRole("button", { name: /Try again/ })[0]!);
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Try again now" }),
    );
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("The job was queued again.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("jobs-DEAD")).toHaveTextContent("3"));
    expect(
      within(await screen.findByRole("table", { name: "Jobs that gave up" })).getAllByRole("row"),
    ).toHaveLength(4);
  });

  it("explains a job someone else already retried, and a refusal by the backend", async () => {
    const user = show(<WalletHealth />);
    const table = await screen.findByRole("table", { name: "Jobs that gave up" });
    current.api.operations.requeueDeadJob = vi
      .fn()
      .mockRejectedValueOnce(fail(404, "not_found", "NOT_FOUND"));
    await user.click(within(table).getAllByRole("button", { name: /Try again/ })[0]!);
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Try again now" }),
    );
    expect(await screen.findByText(/no longer waiting/)).toBeInTheDocument();

    current.api.operations.requeueDeadJob = vi
      .fn()
      .mockRejectedValueOnce(fail(403, "forbidden", "FORBIDDEN"));
    await user.click(
      within(await screen.findByRole("table", { name: "Jobs that gave up" })).getAllByRole(
        "button",
        { name: /Try again/ },
      )[0]!,
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Try again now" }),
    );
    expect(await screen.findByText(en.errors.forbiddenAction)).toBeInTheDocument();
  });

  it("explains when no jobs have given up, and keeps the counts when only the jobs fail", async () => {
    current = createMockApiFor("admin@mock.test");
    current.api.operations.deadJobs = vi.fn().mockResolvedValue([]);
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nProvider locale="en" messages={en}>
          <ToastProvider>
            <WalletHealth />
          </ToastProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("No jobs have given up")).toBeInTheDocument();

    current.api.operations.deadJobs = vi
      .fn()
      .mockRejectedValue(fail(503, "unavailable", "UNAVAILABLE"));
  });

  it("shows the counts even when the list of jobs cannot load", async () => {
    current = createMockApiFor("admin@mock.test");
    current.api.operations.deadJobs = vi
      .fn()
      .mockRejectedValue(fail(503, "unavailable", "UNAVAILABLE"));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nProvider locale="en" messages={en}>
          <ToastProvider>
            <WalletHealth />
          </ToastProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("section-dead-jobs")).toHaveAttribute("data-state", "error"),
    );
    expect(screen.getByTestId("section-job-counts")).toHaveAttribute("data-state", "ready");
  });
});

describe("privacy records", () => {
  it("asks for a merchant first, says what the service does not offer, and shows no customer details", async () => {
    show(<PrivacyView />);
    expect(
      await screen.findByText("Choose a merchant to see its privacy records."),
    ).toBeInTheDocument();
    expect(screen.getByText("A queue of privacy export and deletion requests")).toBeInTheDocument();
    expect(screen.getByText(/no customer details are shown/)).toBeInTheDocument();
  });

  it("asks for the recorded confirmation per merchant, then filters by the kind of record", async () => {
    const user = show(<PrivacyView />);
    await user.selectOptions(await screen.findByLabelText("Merchant"), "Sample Cafe");
    const spy = vi.spyOn(current.api.operations, "audit");
    expect(spy).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Show recent activity" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "View and record" }),
    );
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.at(-1)![0]).toMatchObject({ action: "customer.anonymized" });

    await user.selectOptions(
      screen.getByLabelText("Kind of record"),
      "Customer data viewed or exported",
    );
    await waitFor(() =>
      expect(spy.mock.calls.at(-1)![0]).toMatchObject({ actionPrefix: "customer.data_" }),
    );
  });
});

describe("platform audit", () => {
  it("shows platform-level events by default without asking about any merchant", async () => {
    show(<OpsAudit />);
    const table = await screen.findByRole("table", { name: "Activity history" });
    expect(within(table).getAllByRole("row").length).toBeGreaterThan(1);
    expect(current.api.operations).toBeDefined();
    expect(document.body.textContent).not.toContain("Sample Cafe Owner");
  });

  it("filters by action and needs the recorded confirmation before showing a merchant", async () => {
    const user = show(<OpsAudit />);
    await screen.findByRole("table", { name: "Activity history" });
    await user.selectOptions(screen.getByLabelText("Action"), "outbox.job_requeued");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => {
      const rows = within(screen.getByRole("table", { name: "Activity history" }))
        .getAllByRole("row")
        .slice(1);
      expect(rows.length).toBeGreaterThan(0);
    });

    const spy = vi.spyOn(current.api.operations, "audit");
    spy.mockClear();
    await user.selectOptions(screen.getByLabelText("Merchant (optional)"), "Sample Cafe");
    expect(screen.queryByRole("table", { name: "Activity history" })).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Show recent activity" }));
    expect(
      await screen.findByRole("dialog", { name: "View this merchant's activity?" }),
    ).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("validates the date range before asking", async () => {
    const user = show(<OpsAudit />);
    await screen.findByRole("table", { name: "Activity history" });
    await user.type(screen.getByLabelText("From"), "2026-10-09");
    await user.type(screen.getByLabelText("To"), "2026-10-01");
    expect(
      await screen.findByText("The start date must be before the end date."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply filters" })).toBeDisabled();
  });
});

describe("overview and system", () => {
  it("shows merchant and job counts and the plain list of what is not offered", async () => {
    show(<OpsOverview health={{ live: true, ready: true }} />);
    expect(await screen.findByTestId("jobs-PENDING")).toHaveTextContent("3");
    expect(screen.getByText("Ready")).toBeInTheDocument();
    const list = screen.getByText("Not offered by the service yet").closest("section")!;
    for (const item of [
      en.ops.capMerchantApproval,
      en.ops.capFraud,
      en.ops.capPrivacy,
      en.ops.capSupport,
    ]) {
      expect(within(list).getByText(item)).toBeInTheDocument();
    }
    expect(document.body.textContent).not.toMatch(
      /\brevenue\b|\bbilling\b|\bsubscription\b|\bpayment\b/i,
    );
  });

  it("reports a service that is not ready, and keeps the rest of the page", async () => {
    show(<OpsOverview health={{ live: true, ready: false }} />);
    expect(await screen.findByText("Not ready")).toBeInTheDocument();
    expect(await screen.findByTestId("jobs-DEAD")).toBeInTheDocument();
  });

  it("shows the system state, asks the server to check again, and shows no settings", async () => {
    const user = show(
      <SystemStatus health={{ live: true, ready: false }} checkedAt="2026-10-08T09:00:00Z" />,
    );
    expect(screen.getByText("The service is running")).toBeInTheDocument();
    expect(screen.getByText("The service cannot reach its database right now")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText(/never displayed/)).toBeInTheDocument();
  });

  it("works in Amharic without any English fallback for its own words", async () => {
    show(<OpsOverview health={{ live: true, ready: true }} />, "am");
    expect(await screen.findByText(am.ops.capabilitiesTitle)).toBeInTheDocument();
    expect(screen.queryByText("Not offered by the service yet")).not.toBeInTheDocument();
  });
});
