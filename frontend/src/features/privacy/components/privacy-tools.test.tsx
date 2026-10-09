import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import { CustomersWorkspace } from "@/features/records/components/customers-workspace";
import { ApiError } from "@/lib/errors/api-error";
import { I18nProvider } from "@/lib/i18n/client";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";
import { MOCK_ACCOUNTS, type MockEmail } from "@/mocks/fixtures";
import { anonymize, getRetention, runRetention, setRetention } from "@/mocks/privacy-data";
import { recordsFor } from "@/mocks/records-data";
import { createMockApiFor } from "@/mocks/test-api";
import { RetentionPanel, validRetention } from "./retention-panel";

let current: ReturnType<typeof createMockApiFor>;
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => current.api }));

const fail = (status: number, kind: ApiError["kind"], code: string) =>
  new ApiError({ kind, code, status, message: "backend english text" });

function wrap(ui: React.ReactElement, locale: "en" | "am" = "en") {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider locale={locale} messages={locale === "en" ? en : am}>
        <ToastProvider>{ui}</ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

function showCustomers(email: MockEmail) {
  current = createMockApiFor(email);
  const permissions = MOCK_ACCOUNTS[email].permissions as readonly string[];
  const user = userEvent.setup();
  render(
    wrap(
      <CustomersWorkspace
        canManage={permissions.includes("customer:manage")}
        canReverse={permissions.includes("reversal:create")}
        canPrivacy={permissions.includes("privacy:manage")}
      />,
    ),
  );
  return user;
}

async function openCustomer(user: ReturnType<typeof userEvent.setup>, name: string) {
  const table = await screen.findByRole("table", { name: "Customers" });
  await user.click(within(table).getByRole("button", { name: new RegExp(`View.*${name}`) }));
  const detail = await screen.findByTestId("customer-detail");
  await within(detail).findByText("Free coffee");
  return detail;
}

beforeEach(() => vi.clearAllMocks());

describe("mock privacy rules", () => {
  const records = () => recordsFor(new Map(), "owner@mock.test");

  it("anonymises once, needs an acknowledgement for an unclaimed reward, and is harmless to repeat", () => {
    const r = records();
    const abebe = r.customers[0]!.customer.id; // has an unclaimed reward
    expect(anonymize(r, abebe, { reason: "OTHER" }).status).toBe(409);
    expect(anonymize(r, abebe, { reason: "WHY" }).status).toBe(400);
    expect(
      anonymize(r, abebe, { reason: "OTHER", acknowledgeOutstandingRewards: true }).status,
    ).toBe(200);
    expect(r.customers[0]!.customer.firstName).toBeNull();
    expect(r.customers[0]!.phone).toBe("");
    expect(anonymize(r, abebe, { reason: "OTHER" }).status).toBe(200);
    expect(anonymize(r, "00000000-0000-4000-8000-000000000000", { reason: "OTHER" }).status).toBe(
      404,
    );
  });

  it("accepts 0 or 6 to 120 months, applies the period, and skips customers with an unclaimed reward", () => {
    const r = records();
    expect(setRetention(r, { inactiveCustomerMonths: 3 }).status).toBe(422);
    expect(setRetention(r, { inactiveCustomerMonths: 121 }).status).toBe(422);
    expect(setRetention(r, { inactiveCustomerMonths: 6 }).status).toBe(200);
    expect(getRetention(r).body).toEqual({ inactiveCustomerMonths: 6 });
    const later = Date.now() + 400 * 86_400_000;
    const body = runRetention(r, later).body as { anonymized: number };
    expect(body.anonymized).toBeGreaterThan(0);
    expect(r.customers[0]!.phone).not.toBe(""); // Abebe holds an unclaimed reward
    setRetention(r, { inactiveCustomerMonths: 0 });
    expect(runRetention(r, later).body).toEqual({ anonymized: 0, more: false });
  });
});

describe("customer care tools", () => {
  it("offers an owner everything and a manager only the card tools", async () => {
    const owner = showCustomers("owner@mock.test");
    const detail = await openCustomer(owner, "Abebe");
    for (const name of [
      "Stop marketing messages",
      "Pause this card",
      "Replace the card",
      "Lost or stolen phone",
      "View stored data",
      "Download a copy",
      "Anonymise",
    ]) {
      expect(within(detail).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("does not offer privacy tools to a manager, and nothing to a read-only account", async () => {
    const manager = showCustomers("manager@mock.test");
    const detail = await openCustomer(manager, "Abebe");
    expect(within(detail).getByRole("button", { name: "Pause this card" })).toBeInTheDocument();
    expect(
      within(detail).queryByRole("button", { name: "View stored data" }),
    ).not.toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: "Anonymise" })).not.toBeInTheDocument();
  });

  it("offers no care tools to a read-only account", async () => {
    const viewer = showCustomers("viewer@mock.test");
    const detail = await openCustomer(viewer, "Abebe");
    expect(within(detail).queryByText("Customer care")).not.toBeInTheDocument();
  });

  it("pauses and resumes a card only after confirmation", async () => {
    const user = showCustomers("owner@mock.test");
    const detail = await openCustomer(user, "Abebe");
    const spy = vi.spyOn(current.api.memberships, "deactivate");
    await user.click(within(detail).getByRole("button", { name: "Pause this card" }));
    const dialog = await screen.findByRole("dialog", { name: "Pause this card?" });
    expect(spy).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Card paused")).toBeInTheDocument();
    expect(
      await within(detail).findByRole("button", { name: "Resume this card" }),
    ).toBeInTheDocument();
  });

  it("shows a replacement card code once", async () => {
    const user = showCustomers("owner@mock.test");
    const detail = await openCustomer(user, "Abebe");
    await user.click(within(detail).getByRole("button", { name: "Replace the card" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Replace this card?" })).getByRole(
        "button",
        { name: "Replace card" },
      ),
    );
    const code = await screen.findByTestId("new-card-code");
    expect(code.textContent).toMatch(/^mock-ok-new-/);
    await user.click(
      within(screen.getByRole("dialog", { name: "New card issued" }))
        .getAllByRole("button", { name: "Close" })
        .at(-1)!,
    );
    await waitFor(() => expect(screen.queryByTestId("new-card-code")).not.toBeInTheDocument());
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain("mock-ok-new-");
  });

  it("removes wallet cards after a lost phone and says how many", async () => {
    const user = showCustomers("owner@mock.test");
    const detail = await openCustomer(user, "Abebe");
    await user.click(within(detail).getByRole("button", { name: "Lost or stolen phone" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Remove wallet cards?" })).getByRole(
        "button",
        { name: "Remove wallet cards" },
      ),
    );
    expect(await screen.findByText("1 wallet card(s) removed")).toBeInTheDocument();
  });

  it("queues a fresh delivery of one wallet card", async () => {
    const user = showCustomers("owner@mock.test");
    const detail = await openCustomer(user, "Abebe");
    await user.click(await within(detail).findByRole("button", { name: /Send update again/ }));
    expect(await screen.findByText("Update queued")).toBeInTheDocument();
  });

  it("stops marketing messages and updates the customer", async () => {
    const user = showCustomers("owner@mock.test");
    const detail = await openCustomer(user, "Abebe");
    await user.click(within(detail).getByRole("button", { name: "Stop marketing messages" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Stop marketing messages?" })).getByRole(
        "button",
        { name: "Confirm" },
      ),
    );
    expect(await screen.findByText("Marketing messages stopped")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(detail).getByText(/Offers and news: not agreed/)).toBeInTheDocument(),
    );
    expect(
      within(detail).queryByRole("button", { name: "Stop marketing messages" }),
    ).not.toBeInTheDocument();
  });

  it("explains a refusal in words and changes nothing", async () => {
    const user = showCustomers("owner@mock.test");
    const detail = await openCustomer(user, "Abebe");
    current.api.memberships.deactivate = vi
      .fn()
      .mockRejectedValue(fail(403, "forbidden", "FORBIDDEN"));
    await user.click(within(detail).getByRole("button", { name: "Pause this card" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Pause this card?" })).getByRole("button", {
        name: "Confirm",
      }),
    );
    expect(await screen.findByText("Only owners can use the privacy tools.")).toBeInTheDocument();
    expect(screen.queryByText(/backend english text/)).not.toBeInTheDocument();
  });
});

describe("stored data and anonymising", () => {
  it("shows the stored data for an owner", async () => {
    const user = showCustomers("owner@mock.test");
    const detail = await openCustomer(user, "Abebe");
    await user.click(within(detail).getByRole("button", { name: "View stored data" }));
    const data = await screen.findByTestId("stored-data");
    expect(within(data).getByText("Abebe")).toBeInTheDocument();
    expect(within(data).getByText("+251911000111")).toBeInTheDocument();
    expect(within(data).getByText(/9 stamps, 0 rewards given, 1 corrections/)).toBeInTheDocument();
  });

  it("downloads a copy as a file without keeping it", async () => {
    const created: Blob[] = [];
    const revoke = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (b: Blob) => (created.push(b), "blob:x"),
      revokeObjectURL: revoke,
    });
    const user = showCustomers("owner@mock.test");
    const detail = await openCustomer(user, "Abebe");
    await user.click(within(detail).getByRole("button", { name: "Download a copy" }));
    expect(await screen.findByText("Copy downloaded")).toBeInTheDocument();
    expect(created).toHaveLength(1);
    expect(JSON.parse(await created[0]!.text()).customer.firstName).toBe("Abebe");
    await waitFor(() => expect(revoke).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });

  it("needs the typed word, then the acknowledgement for an unclaimed reward, then anonymises and closes the panel", async () => {
    const user = showCustomers("owner@mock.test");
    const detail = await openCustomer(user, "Abebe");
    const spy = vi.spyOn(current.api.privacy, "anonymize");
    await user.click(within(detail).getByRole("button", { name: "Anonymise" }));
    const dialog = await screen.findByRole("dialog", { name: "Anonymise this customer?" });
    const confirm = within(dialog).getByRole("button", { name: "Anonymise" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Type ANONYMISE/), "ANONYMISE");
    await user.click(confirm);
    expect(
      await within(dialog).findByText(/unclaimed reward, which will be lost/),
    ).toBeInTheDocument();
    expect(spy.mock.calls[0]![1]).toMatchObject({ reason: "CUSTOMER_REQUEST" });
    await user.click(within(dialog).getByLabelText(/I understand/));
    await user.type(within(dialog).getByLabelText(/Type ANONYMISE/), "ANONYMISE");
    await user.click(within(dialog).getByRole("button", { name: "Anonymise" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1]![1]).toMatchObject({ acknowledgeOutstandingRewards: true });
    expect(await screen.findByText("Customer anonymised")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("customer-detail")).not.toBeInTheDocument());
  });

  it("works in Amharic", async () => {
    current = createMockApiFor("owner@mock.test");
    const user = userEvent.setup();
    render(wrap(<CustomersWorkspace canManage canReverse canPrivacy />, "am"));
    const table = await screen.findByRole("table", { name: am.records.customersTableLabel });
    await user.click(
      within(table).getAllByRole("button", { name: new RegExp(am.records.view) })[0]!,
    );
    expect(await screen.findByRole("button", { name: am.privacy.viewData })).toBeInTheDocument();
  });
});

describe("retention panel", () => {
  const show = (email: MockEmail = "owner@mock.test", locale: "en" | "am" = "en") => {
    current = createMockApiFor(email);
    const user = userEvent.setup();
    render(wrap(<RetentionPanel />, locale));
    return user;
  };

  it("checks the value", () => {
    expect(validRetention("0")).toBe(true);
    expect(validRetention("6")).toBe(true);
    expect(validRetention("120")).toBe(true);
    for (const bad of ["", "5", "121", "6.5", "-1", "abc"])
      expect(validRetention(bad), bad).toBe(false);
  });

  it("shows the period, saves a change and explains what is kept", async () => {
    const user = show();
    const field = await screen.findByLabelText(/Months without activity/);
    expect(field).toHaveValue("36");
    expect(screen.getByText(/refer to people only by an internal number/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(field);
    await user.type(field, "24");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Retention period saved")).toBeInTheDocument();
    expect(await screen.findByLabelText(/Months without activity/)).toHaveValue("24");
  });

  it("refuses a value outside the range before asking", async () => {
    const user = show();
    const spy = vi.spyOn(current.api.privacy, "setRetention");
    const field = await screen.findByLabelText(/Months without activity/);
    await user.clear(field);
    await user.type(field, "3");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Enter 0, or a whole number from 6 to 120."),
    ).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("applies the period only after the typed confirmation and reports the count", async () => {
    const user = show();
    await screen.findByLabelText(/Months without activity/);
    const spy = vi.spyOn(current.api.privacy, "runRetention");
    await user.click(screen.getByRole("button", { name: "Apply now" }));
    const dialog = await screen.findByRole("dialog", { name: "Anonymise inactive customers now?" });
    expect(spy).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Anonymise now" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Type ANONYMISE/), "ANONYMISE");
    await user.click(within(dialog).getByRole("button", { name: "Anonymise now" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("No customers were due.")).toBeInTheDocument();
  });

  it("explains a failed load in words", async () => {
    current = createMockApiFor("owner@mock.test");
    current.api.privacy.getRetention = vi
      .fn()
      .mockRejectedValue(fail(503, "unavailable", "UNAVAILABLE"));
    render(wrap(<RetentionPanel />));
    expect(await screen.findByText("We could not load the retention period")).toBeInTheDocument();
    expect(screen.queryByText(/backend english text/)).not.toBeInTheDocument();
  });

  it("works in Amharic", async () => {
    show("owner@mock.test", "am");
    expect(await screen.findByText(am.privacy.retentionTitle)).toBeInTheDocument();
  });
});
