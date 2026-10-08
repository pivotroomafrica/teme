import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import type { Branch } from "@/lib/api/contract";
import { ApiError } from "@/lib/errors/api-error";
import { I18nProvider } from "@/lib/i18n/client";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";
import { MOCK_ACCOUNTS, type MockEmail } from "@/mocks/fixtures";
import { orgFor } from "@/mocks/org-data";
import { createMockApiFor } from "@/mocks/test-api";
import { BranchesWorkspace } from "./branches-workspace";

let current: ReturnType<typeof createMockApiFor>;
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => current.api }));

function show(
  email: MockEmail,
  options: { locale?: "en" | "am"; arrange?: (branches: Branch[]) => void } = {},
) {
  current = createMockApiFor(email);
  options.arrange?.(orgFor(current.state.orgs, email).branches);
  const permissions = MOCK_ACCOUNTS[email].permissions as readonly string[];
  const locale = options.locale ?? "en";
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider locale={locale} messages={locale === "en" ? en : am}>
        <ToastProvider>
          <BranchesWorkspace
            canManage={permissions.includes("branch:manage")}
            canReadStaff={permissions.includes("staff:read")}
          />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return user;
}

const table = () => screen.getByRole("table", { name: "Your branches" });
const row = (name: RegExp | string) => within(table()).getByRole("row", { name });
const cells = (name: RegExp) =>
  within(row(name))
    .getAllByRole("cell")
    .map((c) => c.textContent);
const ready = () => screen.findByRole("table", { name: "Your branches" });
async function pick(user: ReturnType<typeof userEvent.setup>, branch: RegExp, item: string) {
  await user.click(within(row(branch)).getByRole("button", { name: /Actions for/ }));
  await user.click(await screen.findByRole("menuitem", { name: item }));
}

beforeEach(() => vi.restoreAllMocks());

describe("as an owner", () => {
  it("lists every branch, including inactive ones, with location, phone, status and team size", async () => {
    show("owner@mock.test", { arrange: (b) => (b[1]!.status = "INACTIVE") });
    await ready();
    expect(row(/Bole/)).toHaveTextContent("Bole Road, Addis Ababa");
    expect(row(/Bole/)).toHaveTextContent("Active");
    // Selam, the pending invitee and 6 cashiers work at Bole (the deactivated former cashier does not count).
    await waitFor(() => expect(cells(/Bole/)).toContain("8"));
    expect(row(/Piassa/)).toHaveTextContent("Not active");
  });

  it("adds a branch, normalising the phone number, and shows it", async () => {
    const user = show("owner@mock.test");
    await ready();
    await user.click(screen.getByRole("button", { name: "Add branch" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a branch" });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Enter a name.")).toBeInTheDocument();

    await user.type(
      within(dialog).getByRole("textbox", { name: /^Branch name \(English\)/ }),
      "Megenagna",
    );
    await user.type(within(dialog).getByRole("textbox", { name: /^City/ }), "Addis Ababa");
    await user.type(within(dialog).getByRole("textbox", { name: /^Phone number/ }), "0911 234 567");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(row(/Megenagna/)).toHaveTextContent("+251911234567"));
    expect(await screen.findByText("Branch added.")).toBeInTheDocument();
  });

  it("refuses an invalid phone number before sending anything", async () => {
    const user = show("owner@mock.test");
    await ready();
    const create = vi.spyOn(current.api.branches, "create");
    await user.click(screen.getByRole("button", { name: "Add branch" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: /^Branch name \(English\)/ }), "X");
    await user.type(within(dialog).getByRole("textbox", { name: /^Phone number/ }), "12345");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(
      await within(dialog).findByText("Enter a valid Ethiopian phone number, or leave it empty."),
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("edits a branch and sends only what changed", async () => {
    const user = show("owner@mock.test");
    await ready();
    const update = vi.spyOn(current.api.branches, "update");
    await pick(user, /Bole/, "Edit");
    const dialog = await screen.findByRole("dialog", { name: "Edit Bole" });
    const city = within(dialog).getByRole("textbox", { name: /^City/ });
    await user.clear(city);
    await user.type(city, "Bole Sub-city");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(row(/Bole/)).toHaveTextContent("Bole Sub-city"));
    expect(update).toHaveBeenCalledWith(expect.any(String), { city: "Bole Sub-city" });
  });

  it("clears an optional field by sending null", async () => {
    const user = show("owner@mock.test");
    await ready();
    const update = vi.spyOn(current.api.branches, "update");
    await pick(user, /Bole/, "Edit");
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByRole("textbox", { name: /^City/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.any(String), { city: null }));
  });

  it("deactivates after confirmation, saying team members lose access but history stays, and activates again", async () => {
    const user = show("owner@mock.test");
    await ready();
    await pick(user, /Piassa/, "Deactivate");
    const dialog = await screen.findByRole("dialog", { name: "Deactivate Piassa?" });
    expect(dialog).toHaveTextContent("can no longer scan or give rewards at this branch");
    expect(dialog).toHaveTextContent("History is kept");
    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(row(/Piassa/)).toHaveTextContent("Not active"));
    expect(await screen.findByText("Branch deactivated.")).toBeInTheDocument();

    await pick(user, /Piassa/, "Activate");
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Activate" }),
    );
    await waitFor(() => expect(row(/Piassa/)).toHaveTextContent("Active"));
  });

  it("shows the backend's refusal to deactivate the last active branch", async () => {
    const user = show("owner@mock.test", { arrange: (b) => (b[1]!.status = "INACTIVE") });
    await ready();
    await pick(user, /Bole/, "Deactivate");
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Deactivate" }),
    );
    expect(
      await screen.findByText(/A business must keep at least one active branch/),
    ).toBeInTheDocument();
    expect(row(/Bole/)).toHaveTextContent("Active");
  });

  it("lists who works at a branch, never the deactivated, and notes that owners and managers work everywhere", async () => {
    const user = show("owner@mock.test");
    await ready();
    await pick(user, /Piassa/, "Team here");
    const dialog = await screen.findByRole("dialog", { name: "Team at Piassa" });
    const team = await within(dialog).findByTestId("branch-team");
    expect(team).toHaveTextContent("Selam Cashier");
    expect(team).not.toHaveTextContent("Former Cashier"); // deactivated
    expect(team).toHaveTextContent("Owners and managers can work at every branch.");
  });

  it("searches by name or city and says when nothing matches", async () => {
    const user = show("owner@mock.test");
    await ready();
    await user.type(screen.getByRole("searchbox", { name: "Search by name or city" }), "piassa");
    expect(within(table()).getAllByRole("row")).toHaveLength(2);
    await user.clear(screen.getByRole("searchbox", { name: "Search by name or city" }));
    await user.type(screen.getByRole("searchbox", { name: "Search by name or city" }), "zzz");
    expect(screen.getByTestId("no-match")).toBeInTheDocument();
  });

  it("pages a long list", async () => {
    const user = show("owner@mock.test", {
      arrange: (b) => {
        for (let i = 0; i < 13; i++) {
          b.push({
            id: `extra-${i}`,
            nameEn: `Extra ${String(i).padStart(2, "0")}`,
            nameAm: null,
            addressText: null,
            city: null,
            phoneE164: null,
            status: "ACTIVE",
          });
        }
      },
    });
    await ready();
    expect(screen.getByText("Showing 1–10 of 15")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Showing 11–15 of 15")).toBeInTheDocument();
  });

  it("offers every row as a labelled card on a phone, as an alternative to the table", async () => {
    show("owner@mock.test");
    await ready();
    const cards = within(screen.getByTestId("card-list")).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Location");
    expect(cards[0]).toHaveTextContent("Phone");
    expect(within(cards[0]!).getByRole("button", { name: /Actions for/ })).toBeInTheDocument();
  });

  it("speaks Amharic, with the business's own Amharic branch names", async () => {
    show("owner@mock.test", { locale: "am" });
    expect(await screen.findByRole("table", { name: "ቅርንጫፎችዎ" })).toBeInTheDocument();
    expect(screen.getAllByText("ቦሌ").length).toBeGreaterThan(0);
  });
});

describe("as a manager", () => {
  it("manages branches too (branch:manage), and sees the team count", async () => {
    show("manager@mock.test");
    await ready();
    expect(screen.getByRole("button", { name: "Add branch" })).toBeInTheDocument();
    await waitFor(() => expect(cells(/Bole/)).toContain("8"));
  });
});

describe("as branch staff", () => {
  it("sees only their own active branches, cannot change anything and cannot see the team", async () => {
    const user = show("staff@mock.test", { arrange: (b) => (b[1]!.status = "INACTIVE") });
    await ready();
    expect(within(table()).getAllByRole("row")).toHaveLength(2); // header + Bole (Piassa is inactive)
    expect(screen.queryByRole("button", { name: "Add branch" })).not.toBeInTheDocument();
    expect(
      screen.getByText("You can look at the branches but not change them."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Team" })).not.toBeInTheDocument();
    expect(
      within(row(/Bole/)).queryByRole("button", { name: /Actions for/ }),
    ).not.toBeInTheDocument();
    void user;
  });
});

describe("forbidden and read-only scenarios", () => {
  it("lets a read-only account look but not change", async () => {
    const user = show("viewer@mock.test");
    await ready();
    expect(
      screen.getByText("You can look at the branches but not change them."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add branch" })).not.toBeInTheDocument();
    await user.click(within(row(/Bole/)).getByRole("button", { name: /Actions for/ }));
    expect(
      within(row(/Bole/))
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual(["Team here"]);
  });

  it("shows the backend's refusal if a forbidden change is attempted anyway", async () => {
    const user = show("owner@mock.test");
    await ready();
    vi.spyOn(current.api.branches, "deactivate").mockRejectedValue(
      new ApiError({ kind: "forbidden", code: "FORBIDDEN", message: "x", status: 403 }),
    );
    await pick(user, /Piassa/, "Deactivate");
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Deactivate" }),
    );
    expect(await screen.findByText("You are not allowed to do this.")).toBeInTheDocument();
    expect(row(/Piassa/)).toHaveTextContent("Active");
  });

  it("explains a backend that is down and recovers on retry", async () => {
    current = createMockApiFor("owner@mock.test");
    vi.spyOn(current.api.branches, "list").mockRejectedValueOnce(
      new ApiError({
        kind: "unavailable",
        code: "HTTP_503",
        message: "x",
        status: 503,
        requestId: "req-3",
      }),
    );
    const user = userEvent.setup();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nProvider locale="en" messages={en}>
          <ToastProvider>
            <BranchesWorkspace canManage canReadStaff />
          </ToastProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("req-3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table", { name: "Your branches" })).toBeInTheDocument();
  });

  it("invites an empty business to add its first branch", async () => {
    show("owner@mock.test", { arrange: (b) => b.splice(0, b.length) });
    expect(await screen.findByText("No branches yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add branch" }).length).toBeGreaterThan(0);
  });
});
