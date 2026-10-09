import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import { ApiError } from "@/lib/errors/api-error";
import { I18nProvider } from "@/lib/i18n/client";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";
import { MOCK_ACCOUNTS, type MockEmail } from "@/mocks/fixtures";
import { recordsFor } from "@/mocks/records-data";
import { createMockApiFor } from "@/mocks/test-api";
import { AuditWorkspace } from "./audit-workspace";
import { CustomersWorkspace } from "./customers-workspace";
import { RewardsWorkspace } from "./rewards-workspace";

let current: ReturnType<typeof createMockApiFor>;
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => current.api }));

type Screen = "customers" | "audit" | "rewards";

function show(screenName: Screen, email: MockEmail, locale: "en" | "am" = "en") {
  current = createMockApiFor(email);
  const permissions = MOCK_ACCOUNTS[email].permissions as readonly string[];
  const canManage = permissions.includes("customer:manage");
  const canReverse = permissions.includes("reversal:create");
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider locale={locale} messages={locale === "en" ? en : am}>
        <ToastProvider>
          {screenName === "customers" ? (
            <CustomersWorkspace canManage={canManage} canReverse={canReverse} />
          ) : screenName === "audit" ? (
            <AuditWorkspace />
          ) : (
            <RewardsWorkspace
              canManage={canManage}
              canReverse={canReverse}
              canSeeAudit={permissions.includes("audit:read")}
            />
          )}
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return user;
}

const customersTable = () => screen.findByRole("table", { name: "Customers" });
const view = async (name: string) =>
  within(await customersTable()).findByRole("button", { name: new RegExp(`View.*${name}`) });
const fail = (status: number, kind: ApiError["kind"], code: string) =>
  new ApiError({ kind, code, status, message: "backend english text" });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("customers", () => {
  it("lists 10 per page and pages forward and back without repeating anyone", async () => {
    const user = show("customers", "manager@mock.test");
    const first = within(await customersTable())
      .getAllByRole("row")
      .slice(1);
    expect(first).toHaveLength(10);
    expect(screen.getByText("Showing 1–10")).toBeInTheDocument();
    const firstNames = first.map((r) => r.textContent);

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Showing 11–20")).toBeInTheDocument());
    const second = within(await customersTable())
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.textContent);
    expect(second.some((text) => firstNames.includes(text))).toBe(false);

    await user.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(screen.getByText("Showing 1–10")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("lets a manager search by name and see whole phone numbers", async () => {
    const user = show("customers", "manager@mock.test");
    await customersTable();
    await user.type(screen.getByRole("searchbox", { name: "Search customers" }), "abebe{Enter}");
    const table = await customersTable();
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(2));
    expect(within(table).getByText("+251911000111")).toBeInTheDocument();
    expect(screen.queryByText(/hidden to protect privacy/)).not.toBeInTheDocument();
  });

  it("masks phone numbers for branch staff and needs a complete number", async () => {
    const user = show("customers", "staff@mock.test");
    // Staff must give a complete number, so an unfiltered list is a lookup that finds nothing.
    await user.type(screen.getByRole("searchbox", { name: "Search customers" }), "Abebe{Enter}");
    expect(await screen.findByText("No customer matches your search.")).toBeInTheDocument();
    expect(screen.getByText("Enter the customer's complete phone number.")).toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "Search customers" }));
    await user.type(
      screen.getByRole("searchbox", { name: "Search customers" }),
      "0911000111{Enter}",
    );
    const table = await customersTable();
    expect(within(table).getByText("+2519*****111")).toBeInTheDocument();
    expect(screen.queryByText("+251911000111")).not.toBeInTheDocument();
    expect(screen.getByText(/hidden to protect privacy/)).toBeInTheDocument();
  });

  it("masks a number again if one ever arrives unmasked for someone without full access", async () => {
    show("customers", "staff@mock.test");
    current.api.customers.list = vi.fn().mockResolvedValue({
      items: [
        {
          id: "c1",
          firstName: "Leak",
          phone: "+251911000111",
          phoneMasked: false,
          preferredLanguage: "EN",
          joinedAt: "2026-09-01T08:00:00.000Z",
          marketingConsent: false,
          memberships: [],
        },
      ],
      nextCursor: null,
    });
    // Reload with the stubbed client.
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: "Search customers" }), "x{Enter}");
    const table = await customersTable();
    expect(within(table).getByText("+2519*****111")).toBeInTheDocument();
    expect(screen.queryByText("+251911000111")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no customers and an error with a retry when loading fails", async () => {
    show("customers", "manager@mock.test");
    await customersTable();
    current.api.customers.list = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: "Search customers" }), "zz{Enter}");
    expect(await screen.findByText("No customer matches your search.")).toBeInTheDocument();
  });

  it("explains a failed load in words", async () => {
    current = createMockApiFor("manager@mock.test");
    current.api.customers.list = vi.fn().mockRejectedValue(fail(503, "unavailable", "UNAVAILABLE"));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nProvider locale="en" messages={en}>
          <ToastProvider>
            <CustomersWorkspace canManage canReverse />
          </ToastProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("We could not load customers")).toBeInTheDocument();
    expect(screen.queryByText(/backend english text/)).not.toBeInTheDocument();
  });

  it("shows progress, rewards, wallet cards and consent for a customer", async () => {
    const user = show("customers", "manager@mock.test");
    await user.click(await view("Abebe"));
    const detail = await screen.findByTestId("customer-detail");
    expect(await within(detail).findByText("Free coffee")).toBeInTheDocument();
    expect(within(detail).getByText("Available")).toBeInTheDocument();
    expect(within(detail).getByText("Google Wallet")).toBeInTheDocument();
    expect(within(detail).getByText("Web card")).toBeInTheDocument();
    expect(within(detail).getByText(/Offers and news: agreed/)).toBeInTheDocument();
    expect(within(detail).getByText("0 / 8")).toBeInTheDocument();
  });

  it("shows branch staff progress and rewards but not the visit history or reversal controls", async () => {
    const user = show("customers", "staff@mock.test");
    await user.type(
      screen.getByRole("searchbox", { name: "Search customers" }),
      "0911000111{Enter}",
    );
    await user.click(await view("Abebe"));
    const detail = await screen.findByTestId("customer-detail");
    expect(await within(detail).findByText("Free coffee")).toBeInTheDocument();
    expect(
      within(detail).getByText("Visit history is shown to owners and managers."),
    ).toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: /Reverse/ })).not.toBeInTheDocument();
  });

  it("does not offer reversal to someone without the permission, and reports it if the backend refuses anyway", async () => {
    const user = show("customers", "viewer@mock.test");
    await user.click(await view("Abebe"));
    const detail = await screen.findByTestId("customer-detail");
    await within(detail).findByText("Free coffee");
    expect(within(detail).queryByRole("button", { name: /Reverse/ })).not.toBeInTheDocument();
    expect(
      within(detail).getByText("Visit history is shown to owners and managers."),
    ).toBeInTheDocument();
  });
});

describe("reversals", () => {
  async function openAbebe(email: MockEmail = "manager@mock.test") {
    const user = show("customers", email);
    await user.click(await view("Abebe"));
    const detail = await screen.findByTestId("customer-detail");
    await within(detail).findByRole("list", { name: "Visit history" });
    return { user, detail };
  }
  const stampRows = (detail: HTMLElement) =>
    within(detail)
      .getAllByRole("listitem")
      .filter((li) => li.getAttribute("data-entry-type") === "STAMP");

  it("shows the whole history, including entries reversed earlier, marked as reversed and not struck out", async () => {
    const { detail } = await openAbebe();
    const reversed = stampRows(detail).filter((li) => li.getAttribute("data-reversed") === "true");
    expect(reversed).toHaveLength(1);
    expect(within(reversed[0]!).getByText("Reversed")).toBeInTheDocument();
    expect(within(reversed[0]!).queryByRole("button", { name: /Reverse/ })).not.toBeInTheDocument();
    expect(within(detail).getByText(/Reason: Scanned twice by mistake/)).toBeInTheDocument();
    expect(within(detail).getByText(/Reversed entries stay in the history/)).toBeInTheDocument();
  });

  it("makes a reason mandatory and needs the typed word before anything is sent", async () => {
    const { user, detail } = await openAbebe();
    const spy = vi.spyOn(current.api.memberships, "reverseStamp");
    await user.click(
      within(stampRows(detail).find((li) => !li.getAttribute("data-reversed"))!).getByRole(
        "button",
        { name: /Reverse/ },
      ),
    );
    const dialog = await screen.findByRole("dialog", { name: "Reverse this stamp" });
    expect(within(dialog).getByText("Original entry")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Review" }));
    expect(await within(dialog).findByText("Write at least 3 characters.")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/Reason/), "Counted twice");
    await user.click(within(dialog).getByRole("button", { name: "Review" }));
    const confirm = within(dialog).getByRole("button", { name: "Reverse now" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Type REVERSE to confirm/), "reverse");
    expect(confirm).toBeDisabled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("appends and shows the correction after success, keeping the original visible", async () => {
    const { user, detail } = await openAbebe();
    const before = within(detail)
      .getAllByRole("listitem")
      .filter((li) => li.getAttribute("data-entry-type")).length;
    const target = stampRows(detail).find((li) => !li.getAttribute("data-reversed"))!;
    await user.click(within(target).getByRole("button", { name: /Reverse/ }));
    const dialog = await screen.findByRole("dialog", { name: "Reverse this stamp" });
    await user.type(within(dialog).getByLabelText(/Reason/), "Counted twice");
    await user.click(within(dialog).getByRole("button", { name: "Review" }));
    await user.type(within(dialog).getByLabelText(/Type REVERSE to confirm/), "REVERSE");
    await user.click(within(dialog).getByRole("button", { name: "Reverse now" }));

    const result = await within(dialog).findByTestId("reversal-result");
    expect(within(result).getByText("New correction")).toBeInTheDocument();
    expect(within(result).getByText(/Progress now: 7 of 8 stamps/)).toBeInTheDocument();
    expect(within(dialog).getByText(/original entry is still in the history/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(
        within(detail)
          .getAllByRole("listitem")
          .filter((li) => li.getAttribute("data-entry-type")).length,
      ).toBe(before + 1),
    );
    const rows = within(detail).getAllByRole("listitem");
    expect(rows.some((li) => li.getAttribute("data-new") === "true")).toBe(true);
    expect(rows.filter((li) => li.getAttribute("data-reversed") === "true")).toHaveLength(2);
    expect(within(detail).getByText(/Reason: Counted twice/)).toBeInTheDocument();
  });

  it("explains that a given reward must be reversed first", async () => {
    const user = show("customers", "owner@mock.test");
    await user.click(await view("Dawit"));
    const detail = await screen.findByTestId("customer-detail");
    await within(detail).findByRole("list", { name: "Visit history" });
    await user.click(
      within(stampRows(detail).find((li) => !li.getAttribute("data-reversed"))!).getByRole(
        "button",
        { name: /Reverse/ },
      ),
    );
    const dialog = await screen.findByRole("dialog", { name: "Reverse this stamp" });
    await user.type(within(dialog).getByLabelText(/Reason/), "Wrong customer");
    await user.click(within(dialog).getByRole("button", { name: "Review" }));
    await user.type(within(dialog).getByLabelText(/Type REVERSE to confirm/), "REVERSE");
    await user.click(within(dialog).getByRole("button", { name: "Reverse now" }));
    expect(await within(dialog).findByText(/Reverse the given reward first/)).toBeInTheDocument();
    expect(within(dialog).queryByTestId("reversal-result")).not.toBeInTheDocument();
  });

  it("reports a refusal from the backend in words and changes nothing", async () => {
    const { user, detail } = await openAbebe();
    current.api.memberships.reverseStamp = vi
      .fn()
      .mockRejectedValue(fail(403, "forbidden", "FORBIDDEN"));
    await user.click(
      within(stampRows(detail).find((li) => !li.getAttribute("data-reversed"))!).getByRole(
        "button",
        { name: /Reverse/ },
      ),
    );
    const dialog = await screen.findByRole("dialog", { name: "Reverse this stamp" });
    await user.type(within(dialog).getByLabelText(/Reason/), "Because");
    await user.click(within(dialog).getByRole("button", { name: "Review" }));
    await user.type(within(dialog).getByLabelText(/Type REVERSE to confirm/), "REVERSE");
    await user.click(within(dialog).getByRole("button", { name: "Reverse now" }));
    expect(
      await within(dialog).findByText("Only owners and managers can reverse entries."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/backend english text/)).not.toBeInTheDocument();
  });

  it("reuses the same idempotency key when the same reason is sent again after a lost answer", async () => {
    const { user, detail } = await openAbebe();
    const keys: string[] = [];
    const real = current.api.memberships.reverseStamp;
    current.api.memberships.reverseStamp = vi.fn(
      async (id: string, reason: string, key: string) => {
        keys.push(key);
        if (keys.length === 1) throw fail(0, "network", "NETWORK_ERROR");
        return real(id, reason, key);
      },
    );
    await user.click(
      within(stampRows(detail).find((li) => !li.getAttribute("data-reversed"))!).getByRole(
        "button",
        { name: /Reverse/ },
      ),
    );
    const dialog = await screen.findByRole("dialog", { name: "Reverse this stamp" });
    await user.type(within(dialog).getByLabelText(/Reason/), "Counted twice");
    await user.click(within(dialog).getByRole("button", { name: "Review" }));
    await user.type(within(dialog).getByLabelText(/Type REVERSE to confirm/), "REVERSE");
    await user.click(within(dialog).getByRole("button", { name: "Reverse now" }));
    await within(dialog).findByText(en.errors.network);
    await user.click(within(dialog).getByRole("button", { name: "Reverse now" }));
    await within(dialog).findByTestId("reversal-result");
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});

describe("audit history", () => {
  const table = () => screen.findByRole("table", { name: "Activity history" });

  it("shows human-readable actions, newest first, 10 per page", async () => {
    show("audit", "owner@mock.test");
    const rows = within(await table())
      .getAllByRole("row")
      .slice(1);
    expect(rows).toHaveLength(10);
    const first = within(rows[0]!)
      .getAllByRole("cell")
      .map((c) => c.textContent)
      .join(" ");
    expect(first).not.toMatch(/\w+\.\w+/); // no raw codes like stamp.issued
    expect(screen.getByText("Showing 1–10")).toBeInTheDocument();
  });

  it("pages forward and back", async () => {
    const user = show("audit", "owner@mock.test");
    await table();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Showing 11–20")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(screen.getByText("Showing 1–10")).toBeInTheDocument());
  });

  it("filters by action and shows an empty state when nothing matches", async () => {
    const user = show("audit", "owner@mock.test");
    await table();
    await user.selectOptions(screen.getByLabelText("Action"), "Stamp reversed");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(async () => {
      const rows = within(await table())
        .getAllByRole("row")
        .slice(1);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows)
        expect(within(row).getAllByText("Stamp reversed").length).toBeGreaterThan(0);
    });

    await user.type(screen.getByLabelText("Reference of the item"), "no-such-item");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("No activity matches these filters.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await table()).toBeInTheDocument();
  });

  it("filters by team member and by branch", async () => {
    const user = show("audit", "owner@mock.test");
    await table();
    await waitFor(() =>
      expect(
        within(screen.getByLabelText("Team member")).getByRole("option", { name: "Selam Cashier" }),
      ).toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByLabelText("Team member"), "Selam Cashier");
    await user.selectOptions(screen.getByLabelText("Branch"), "Piassa");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    const rows = within(await table())
      .getAllByRole("row")
      .slice(1);
    for (const row of rows) {
      expect(within(row).getByText("Selam Cashier")).toBeInTheDocument();
      expect(within(row).getAllByText("Piassa").length).toBeGreaterThan(0);
    }
  });

  it("validates the date range before asking the backend", async () => {
    const user = show("audit", "owner@mock.test");
    await table();
    const spy = vi.spyOn(current.api.audit, "list");
    spy.mockClear();
    await user.type(screen.getByLabelText("From"), "2026-10-09");
    await user.type(screen.getByLabelText("To"), "2026-10-01");
    expect(
      await screen.findByText("The start date must be before the end date."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply filters" })).toBeDisabled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("expands safe details only, never secrets, tokens, passwords or wallet credentials", async () => {
    const user = show("audit", "owner@mock.test");
    const rows = within(await table()).getAllByRole("row");
    const login = rows.find((r) => within(r).queryByText("Signed in"));
    // The sign-in entry carries bait secrets in the mock data; find it across pages if needed.
    let target = login;
    for (let i = 0; !target && i < 3; i += 1) {
      await user.click(screen.getByRole("button", { name: "Next" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
      target = within(await table())
        .getAllByRole("row")
        .find((r) => within(r).queryByText("Signed in"));
    }
    expect(target).toBeDefined();
    const toggle = within(target!).getByRole("button", { name: /Show details/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(within(target!).getByRole("button", { name: /Hide details/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const html = document.body.innerHTML;
    for (const secret of [
      "BAIT-TOKEN-VALUE",
      "BAIT-PASSWORD",
      "BAIT-WALLET-CREDENTIAL",
      "BaitBrowser",
      "10.0.0.7",
    ]) {
      expect(html).not.toContain(secret);
    }
    expect(within(target!).getByText("Method")).toBeInTheDocument();
    expect(within(target!).getByText(/never shown/)).toBeInTheDocument();
  });

  it("reports a failed load in words with a retry", async () => {
    current = createMockApiFor("owner@mock.test");
    current.api.audit.list = vi.fn().mockRejectedValue(fail(503, "unavailable", "UNAVAILABLE"));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nProvider locale="en" messages={en}>
          <AuditWorkspace />
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("We could not load the activity history")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again|Retry/ })).toBeInTheDocument();
  });

  it("shows an empty state when there is no activity at all", async () => {
    current = createMockApiFor("owner@mock.test");
    recordsFor(current.state.records, "owner@mock.test").audit.length = 0;
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nProvider locale="en" messages={en}>
          <AuditWorkspace />
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
  });

  it("works in Amharic without falling back to English text", async () => {
    show("audit", "owner@mock.test", "am");
    expect(
      await screen.findByRole("table", { name: am.records.auditTableLabel }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: am.records.applyFilters })).toBeInTheDocument();
  });
});

describe("rewards", () => {
  it("lists rewards given and reversed events with branch and team filters", async () => {
    const user = show("rewards", "owner@mock.test");
    const given = await screen.findByRole("table", { name: "Activity" });
    for (const row of within(given).getAllByRole("row").slice(1)) {
      expect(within(row).getAllByText("Reward given").length).toBeGreaterThan(0);
    }
    await user.click(screen.getByRole("tab", { name: "Reversed events" }));
    const reversed = await screen.findByRole("table", { name: "Activity" });
    await waitFor(() =>
      expect(within(reversed).getAllByText("Given reward reversed").length).toBeGreaterThan(0),
    );
    await user.selectOptions(
      within(screen.getByRole("tabpanel")).getByLabelText("What"),
      "Stamp reversed",
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("tabpanel")).getAllByText("Stamp reversed").length,
      ).toBeGreaterThan(0),
    );
  });

  it("shows no money values anywhere", async () => {
    show("rewards", "owner@mock.test");
    await screen.findByRole("table", { name: "Activity" });
    expect(document.body.textContent).not.toMatch(/\bETB\b|\bbirr\b|\$|€|price|revenue/i);
  });

  it("offers the customer lookup but not the activity to someone without audit access", async () => {
    show("rewards", "staff@mock.test");
    expect(await screen.findByRole("searchbox", { name: "Search customers" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Reversed events" })).not.toBeInTheDocument();
  });

  it("shows an empty state when no rewards have been given", async () => {
    current = createMockApiFor("owner@mock.test");
    const records = recordsFor(current.state.records, "owner@mock.test");
    records.audit = records.audit.filter((e) => e.action !== "reward.redeemed");
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nProvider locale="en" messages={en}>
          <RewardsWorkspace canManage canReverse canSeeAudit />
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("No rewards given yet")).toBeInTheDocument();
  });
});
