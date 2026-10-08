import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import type { Staff } from "@/lib/api/contract";
import { ApiError } from "@/lib/errors/api-error";
import { I18nProvider } from "@/lib/i18n/client";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";
import { MOCK_ACCOUNTS, type MockEmail } from "@/mocks/fixtures";
import { orgFor } from "@/mocks/org-data";
import { createMockApiFor } from "@/mocks/test-api";
import { TeamWorkspace } from "./team-workspace";

let current: ReturnType<typeof createMockApiFor>;
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => current.api }));

/** The real clients over the mock backend, signed in as one of the mock accounts. */
function show(
  email: MockEmail,
  options: { locale?: "en" | "am"; arrange?: (staff: Staff[]) => void } = {},
) {
  current = createMockApiFor(email);
  options.arrange?.(orgFor(current.state.orgs, email).staff);
  const account = MOCK_ACCOUNTS[email];
  const locale = options.locale ?? "en";
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider locale={locale} messages={locale === "en" ? en : am}>
        <ToastProvider>
          <TeamWorkspace
            actor={{ userId: account.id, role: account.role }}
            canManage={(account.permissions as readonly string[]).includes("staff:manage")}
          />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return user;
}

const table = () => screen.getByRole("table", { name: "Your team" });
const row = (name: RegExp | string) => within(table()).getByRole("row", { name });
const ready = async () => screen.findByRole("table", { name: "Your team" });

async function pick(user: ReturnType<typeof userEvent.setup>, person: RegExp, item: string) {
  await user.click(within(row(person)).getByRole("button", { name: /Actions for/ }));
  await user.click(await screen.findByRole("menuitem", { name: item }));
}
const item = (person: RegExp, name: string) => {
  // Opened by the caller; returns the menu item without clicking.
  return within(row(person)).getByRole("menuitem", { name });
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("as an owner", () => {
  it("lists the team 10 at a time, with roles, statuses and branches", async () => {
    const user = show("owner@mock.test");
    await ready();
    expect(within(table()).getAllByRole("row")).toHaveLength(11); // header + 10
    expect(screen.getByText("Showing 1–10 of 17")).toBeInTheDocument();
    expect(row(/Hana Owner/)).toHaveTextContent("Owner");
    expect(row(/Hana Owner/)).toHaveTextContent("Every branch");
    expect(row(/Selam Cashier/)).toHaveTextContent("Bole, Piassa");
    expect(row(/Pending Person/)).toHaveTextContent("Invitation pending");
    expect(row(/Former Cashier/)).toHaveTextContent("Deactivated");

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Showing 11–17 of 17")).toBeInTheDocument();
    expect(within(table()).getAllByRole("row")).toHaveLength(8);
  });

  it("shows no credentials or security details anywhere", async () => {
    show("owner@mock.test");
    await ready();
    expect(document.body.textContent).not.toMatch(
      /password|hash|secret|user agent|ip address|\btoken\b/i,
    );
  });

  it("marks the signed-in person and offers no management of themselves", async () => {
    const user = show("owner@mock.test");
    await ready();
    expect(within(row(/Hana Owner/)).getByText("You")).toBeInTheDocument();
    expect(
      screen.getByText(/You cannot change your own role, branches or access/),
    ).toBeInTheDocument();
    await user.click(within(row(/Hana Owner/)).getByRole("button", { name: /Actions for/ }));
    for (const name of ["Change role", "Change branches", "Deactivate"]) {
      expect(item(/Hana Owner/, name)).toHaveAttribute("aria-disabled", "true");
    }
    expect(item(/Hana Owner/, "Recent activity")).not.toHaveAttribute("aria-disabled");
  });

  it("filters by name or email, role and status, and says when nothing matches", async () => {
    const user = show("owner@mock.test");
    await ready();
    await user.type(
      screen.getByRole("searchbox", { name: "Search by name or email" }),
      "cashier 0",
    );
    expect(within(table()).getAllByRole("row").length).toBe(10); // header + Cashier 01..09
    await user.clear(screen.getByRole("searchbox", { name: "Search by name or email" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "DEACTIVATED");
    expect(within(table()).getAllByRole("row")).toHaveLength(2);
    expect(row(/Former Cashier/)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Role" }), "OWNER");
    expect(screen.getByTestId("no-match")).toHaveTextContent(
      "Nobody matches your search or filters.",
    );
  });

  describe("inviting", () => {
    it("checks the form, needs a branch for branch staff, then shows the one-time code once", async () => {
      const user = show("owner@mock.test");
      await ready();
      await user.click(screen.getByRole("button", { name: "Invite someone" }));
      const dialog = await screen.findByRole("dialog", { name: "Invite a team member" });
      await user.click(within(dialog).getByRole("button", { name: "Create invitation" }));
      expect(await within(dialog).findByText("Enter a valid email address.")).toBeInTheDocument();
      expect(within(dialog).getByText("Enter a name.")).toBeInTheDocument();
      expect(
        within(dialog).getAllByText("Choose at least one branch for branch staff.").length,
      ).toBeGreaterThan(0);

      await user.type(
        within(dialog).getByRole("textbox", { name: /Email address/ }),
        "new.cashier@mock.test",
      );
      await user.type(within(dialog).getByRole("textbox", { name: /^Name/ }), "New Cashier");
      await user.click(within(dialog).getByText("Bole"));
      await user.click(within(dialog).getByRole("button", { name: "Create invitation" }));

      const tokenDialog = await screen.findByRole("dialog", { name: "Invitation for New Cashier" });
      const code = (
        within(tokenDialog).getByRole("textbox", { name: "Invitation code" }) as HTMLInputElement
      ).value;
      expect(code.length).toBeGreaterThan(16);
      expect(tokenDialog).toHaveTextContent("No email is sent");
      expect(tokenDialog).toHaveTextContent("works once");

      await user.click(within(tokenDialog).getByRole("button", { name: "I have given it" }));
      await waitFor(() => expect(screen.queryByTestId("invitation-token")).not.toBeInTheDocument());
      expect(document.body.textContent).not.toContain(code); // gone, and never stored in the page
      await user.type(
        screen.getByRole("searchbox", { name: "Search by name or email" }),
        "New Cashier",
      );
      expect(row(/New Cashier/)).toHaveTextContent("Invitation pending");
    });

    it("offers owners every role, and managers only branch staff", async () => {
      const user = show("owner@mock.test");
      await ready();
      await user.click(screen.getByRole("button", { name: "Invite someone" }));
      const roles = within(await screen.findByRole("dialog")).getByRole("combobox", {
        name: /Role/,
      });
      expect(
        within(roles)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(["Owner", "Manager", "Branch staff"]);
    });

    it("answers the same way whether the address is used here or elsewhere", async () => {
      const user = show("owner@mock.test");
      await ready();
      await user.click(screen.getByRole("button", { name: "Invite someone" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(
        within(dialog).getByRole("textbox", { name: /Email address/ }),
        "staff@mock.test",
      );
      await user.type(within(dialog).getByRole("textbox", { name: /^Name/ }), "Duplicate");
      await user.click(within(dialog).getByText("Bole"));
      await user.click(within(dialog).getByRole("button", { name: "Create invitation" }));
      expect(
        (await within(dialog).findAllByText(/This person cannot be invited/)).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByTestId("invitation-token")).not.toBeInTheDocument();
    });
  });

  describe("changing a role", () => {
    it("changes it and shows the new role", async () => {
      const user = show("owner@mock.test");
      await ready();
      await pick(user, /Dawit Manager/, "Change role");
      const dialog = await screen.findByRole("dialog", {
        name: "Change the role of Dawit Manager",
      });
      expect(dialog).toHaveTextContent("Current role: Manager");
      await user.selectOptions(within(dialog).getByRole("combobox", { name: "Role" }), "STAFF");
      await user.click(within(dialog).getByRole("button", { name: "Change role" }));
      await waitFor(() => expect(row(/Dawit Manager/)).toHaveTextContent("Branch staff"));
      expect(await screen.findByText("Role changed.")).toBeInTheDocument();
    });

    it("needs a typed word to remove owner access, and the backend refuses the last active owner", async () => {
      const user = show("owner@mock.test", {
        arrange: (staff) => {
          // The signed-in owner stepped down earlier; "Second Owner" is now the only active owner.
          staff.find((s) => s.id === MOCK_ACCOUNTS["owner@mock.test"].id)!.status = "DEACTIVATED";
          staff.push({
            id: "second-owner",
            displayName: "Second Owner",
            email: "second@mock.test",
            roleKey: "OWNER",
            status: "ACTIVE",
            branchIds: [],
          });
        },
      });
      await ready();
      await user.type(screen.getByRole("searchbox", { name: "Search by name or email" }), "Second");
      await pick(user, /Second Owner/, "Change role");
      const dialog = await screen.findByRole("dialog");
      expect(dialog).not.toHaveTextContent("the backend will refuse this"); // nothing is being lowered yet
      await user.selectOptions(within(dialog).getByRole("combobox", { name: "Role" }), "MANAGER");
      expect(dialog).toHaveTextContent(
        "This is the only active owner, so the backend will refuse this.",
      );
      expect(dialog).toHaveTextContent("Changing their role removes their owner access");
      const confirm = within(dialog).getByRole("button", { name: "Change role" });
      expect(confirm).toBeDisabled();
      await user.type(within(dialog).getByRole("textbox"), "CONFIRM");
      await user.click(confirm);
      // The page does not decide: the backend's answer is shown, and nothing changed.
      expect(
        await within(dialog).findByText(/A business must keep at least one active owner/),
      ).toBeInTheDocument();
      expect(row(/Second Owner/)).toHaveTextContent("Owner");
    });
  });

  describe("branches", () => {
    it("replaces a member's branches, and will not let branch staff end up with none", async () => {
      const user = show("owner@mock.test");
      await ready();
      await pick(user, /Selam Cashier/, "Change branches");
      const dialog = await screen.findByRole("dialog", { name: "Branches for Selam Cashier" });
      await user.click(within(dialog).getByText("Bole"));
      await user.click(within(dialog).getByText("Piassa"));
      expect(
        within(dialog).getByText("Choose at least one branch for branch staff."),
      ).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
      await user.click(within(dialog).getByText("Piassa"));
      await user.click(within(dialog).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(row(/Selam Cashier/)).not.toHaveTextContent("Bole"));
      expect(await screen.findByText("Branches updated.")).toBeInTheDocument();
    });
  });

  describe("activating and deactivating", () => {
    it("deactivates after confirmation (history kept) and activates again", async () => {
      const user = show("owner@mock.test");
      await ready();
      await pick(user, /Selam Cashier/, "Deactivate");
      const dialog = await screen.findByRole("dialog", { name: "Deactivate Selam Cashier?" });
      expect(dialog).toHaveTextContent("Their history is kept");
      await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));
      await waitFor(() => expect(row(/Selam Cashier/)).toHaveTextContent("Deactivated"));

      await pick(user, /Selam Cashier/, "Activate");
      await user.click(
        within(await screen.findByRole("dialog")).getByRole("button", { name: "Activate" }),
      );
      await waitFor(() => expect(row(/Selam Cashier/)).toHaveTextContent("Active"));
    });

    it("offers a new invitation code, not activation, to someone who has not accepted", async () => {
      const user = show("owner@mock.test");
      await ready();
      await user.click(within(row(/Pending Person/)).getByRole("button", { name: /Actions for/ }));
      expect(
        within(row(/Pending Person/)).queryByRole("menuitem", { name: "Activate" }),
      ).not.toBeInTheDocument();
      await user.click(item(/Pending Person/, "New invitation code"));
      const dialog = await screen.findByRole("dialog", {
        name: "New invitation code for Pending Person?",
      });
      expect(dialog).toHaveTextContent("The old code stops working at once");
      await user.click(within(dialog).getByRole("button", { name: "New invitation code" }));
      expect(await screen.findByTestId("invitation-token")).toBeInTheDocument();
    });
  });

  describe("recent activity", () => {
    it("shows the counts and the audited actions, loading more on request, with no security details", async () => {
      const user = show("owner@mock.test");
      await ready();
      await pick(user, /Selam Cashier/, "Recent activity");
      const dialog = await screen.findByRole("dialog", { name: "Recent activity: Selam Cashier" });
      const activity = await within(dialog).findByTestId("activity");
      expect(activity).toHaveTextContent("Stamps issued");
      expect(activity).toHaveTextContent("41");
      expect(within(dialog).getAllByRole("listitem")).toHaveLength(10);
      await user.click(within(dialog).getByRole("button", { name: "Show more" }));
      await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(20));
      await user.click(within(dialog).getByRole("button", { name: "Show more" }));
      await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(23));
      expect(within(dialog).queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
      expect(dialog).toHaveTextContent("Stamp added");
      // The events and counts carry only actions, times and numbers.
      expect(within(dialog).getByTestId("activity").textContent).not.toMatch(
        /\bip\b|user agent|password|hash|token/i,
      );
    });
  });

  it("speaks Amharic", async () => {
    show("owner@mock.test", { locale: "am" });
    expect(await screen.findByRole("table", { name: "ቡድንዎ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ሰው ይጋብዙ" })).toBeInTheDocument();
  });
});

describe("as a manager", () => {
  it("manages branch staff only, and says so", async () => {
    const user = show("manager@mock.test");
    await ready();
    expect(screen.getByText("As a manager you can manage branch staff only.")).toBeInTheDocument();
    for (const person of [/Hana Owner/, /Dawit Manager/]) {
      await user.click(within(row(person)).getByRole("button", { name: /Actions for/ }));
      expect(item(person, "Change role")).toHaveAttribute("aria-disabled", "true");
      expect(item(person, "Deactivate")).toHaveAttribute("aria-disabled", "true");
      await user.keyboard("{Escape}");
    }
    await user.click(within(row(/Selam Cashier/)).getByRole("button", { name: /Actions for/ }));
    expect(item(/Selam Cashier/, "Change role")).not.toHaveAttribute("aria-disabled");
    expect(item(/Selam Cashier/, "Deactivate")).not.toHaveAttribute("aria-disabled");
  });

  it("can invite branch staff only", async () => {
    const user = show("manager@mock.test");
    await ready();
    await user.click(screen.getByRole("button", { name: "Invite someone" }));
    const roles = within(await screen.findByRole("dialog")).getByRole("combobox", { name: /Role/ });
    expect(
      within(roles)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Branch staff"]);
    expect(screen.getByText("Managers can invite branch staff only.")).toBeInTheDocument();
  });

  it("can change a branch staff member's role only up to what a manager may grant", async () => {
    const user = show("manager@mock.test");
    await ready();
    await pick(user, /Selam Cashier/, "Change role");
    const roles = within(await screen.findByRole("dialog")).getByRole("combobox", { name: "Role" });
    expect(
      within(roles)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Branch staff"]);
  });

  it("shows the backend's refusal if it is asked anyway: a disabled button is not the protection", async () => {
    const user = show("manager@mock.test");
    await ready();
    vi.spyOn(current.api.team, "deactivate").mockRejectedValue(
      new ApiError({ kind: "forbidden", code: "FORBIDDEN", message: "x", status: 403 }),
    );
    await pick(user, /Selam Cashier/, "Deactivate");
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Deactivate" }),
    );
    expect(await screen.findByText("You can only manage branch staff.")).toBeInTheDocument();
    expect(row(/Selam Cashier/)).toHaveTextContent("Active");
  });
});

describe("forbidden and read-only scenarios", () => {
  it("shows branch staff (no staff:read) a refusal instead of a team list", async () => {
    show("staff@mock.test");
    expect(await screen.findByText("We could not load the team")).toBeInTheDocument();
    expect(screen.getByText("You are not allowed to do this.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite someone" })).not.toBeInTheDocument();
  });

  it("lets a read-only account look but offers no change", async () => {
    const user = show("viewer@mock.test");
    await ready();
    expect(screen.getByText("You can see the team but not change it.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite someone" })).not.toBeInTheDocument();
    await user.click(within(row(/Selam Cashier/)).getByRole("button", { name: /Actions for/ }));
    expect(
      within(row(/Selam Cashier/))
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual(["Recent activity"]);
  });

  it("explains a backend that is down, and recovers on retry", async () => {
    current = createMockApiFor("owner@mock.test");
    vi.spyOn(current.api.team, "list").mockRejectedValueOnce(
      new ApiError({
        kind: "unavailable",
        code: "HTTP_503",
        message: "x",
        status: 503,
        requestId: "req-7",
      }),
    );
    const user = userEvent.setup();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nProvider locale="en" messages={en}>
          <ToastProvider>
            <TeamWorkspace
              actor={{ userId: MOCK_ACCOUNTS["owner@mock.test"].id, role: "OWNER" }}
              canManage
            />
          </ToastProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("We could not load the team")).toBeInTheDocument();
    expect(screen.getByText("req-7")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table", { name: "Your team" })).toBeInTheDocument();
  });
});
