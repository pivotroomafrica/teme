import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import { ApiError } from "@/lib/errors/api-error";
import { I18nProvider } from "@/lib/i18n/client";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";
import { audienceSize, campaignsFor, createCampaign, sendCampaign } from "@/mocks/campaigns-data";
import { recordsFor } from "@/mocks/records-data";
import { createMockApiFor } from "@/mocks/test-api";
import { CampaignsWorkspace } from "./campaigns-workspace";

let current: ReturnType<typeof createMockApiFor>;
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => current.api }));

const fail = (status: number, kind: ApiError["kind"], code: string) =>
  new ApiError({ kind, code, status, message: "backend english text" });

function show(locale: "en" | "am" = "en") {
  current = createMockApiFor("owner@mock.test");
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider locale={locale} messages={locale === "en" ? en : am}>
        <ToastProvider>
          <CampaignsWorkspace />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return user;
}

async function makeDraft(user: ReturnType<typeof userEvent.setup>, name = "Autumn offer") {
  await user.click(await screen.findByRole("button", { name: "New campaign" }));
  const dialog = await screen.findByRole("dialog", { name: "New campaign" });
  await user.type(within(dialog).getByLabelText(/^Name/), name);
  await user.type(within(dialog).getByLabelText(/^Message \(English\)/), "Come in this week.");
  await user.click(within(dialog).getByRole("button", { name: "Save as draft" }));
  await screen.findByText("Draft saved");
}

beforeEach(() => vi.clearAllMocks());

describe("mock campaign rules", () => {
  const setup = () => {
    const records = recordsFor(new Map(), "owner@mock.test");
    return { records, data: campaignsFor(new Map(), "owner@mock.test") };
  };

  it("only ever reaches customers who agreed to marketing and are not anonymised", () => {
    const { records } = setup();
    const agreed = records.customers.filter((c) => c.customer.marketingConsent).length;
    expect(audienceSize(records, "ALL_OPTED_IN")).toBe(agreed);
    records.customers.find((c) => c.customer.marketingConsent)!.phone = "";
    expect(audienceSize(records, "ALL_OPTED_IN")).toBe(agreed - 1);
    expect(audienceSize(records, "NEAR_REWARD")).toBeLessThanOrEqual(agreed);
  });

  it("validates, then sends a draft once and refuses to change it afterwards", () => {
    const { records, data } = setup();
    expect(
      createCampaign(data, records, { name: "", messageEn: "x", audience: "ALL_OPTED_IN" }).status,
    ).toBe(400);
    expect(
      createCampaign(data, records, { name: "A", messageEn: "x", audience: "EVERYONE" }).status,
    ).toBe(400);
    expect(
      createCampaign(data, records, {
        name: "A",
        messageEn: "y".repeat(301),
        audience: "ALL_OPTED_IN",
      }).status,
    ).toBe(400);
    const made = createCampaign(data, records, {
      name: "A",
      messageEn: "Hi",
      audience: "ALL_OPTED_IN",
    });
    expect(made.status).toBe(201);
    const id = (made.body as { id: string }).id;
    expect(sendCampaign(data, id, undefined).status).toBe(400);
    expect(sendCampaign(data, id, "key-aaaaaaaa").status).toBe(200);
    expect((sendCampaign(data, id, "key-aaaaaaaa").body as { replayed: boolean }).replayed).toBe(
      true,
    );
    expect(sendCampaign(data, id, "key-bbbbbbbb").status).toBe(409);
    expect(sendCampaign(data, "00000000-0000-4000-8000-000000000000", "key-cccccccc").status).toBe(
      404,
    );
  });
});

describe("campaigns screen", () => {
  it("says it is a preview and that only customers who agreed are included", async () => {
    show();
    expect(await screen.findByText("Preview only")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is sent to any customer/)).toBeInTheDocument();
    expect(
      screen.getByText(/Only customers who agreed to offers and news are ever included/),
    ).toBeInTheDocument();
    expect(await screen.findByText("No campaigns yet")).toBeInTheDocument();
  });

  it("checks the form before asking, then saves a draft that shows who it reaches", async () => {
    const user = show();
    await user.click(await screen.findByRole("button", { name: "New campaign" }));
    const dialog = await screen.findByRole("dialog", { name: "New campaign" });
    const spy = vi.spyOn(current.api.campaigns, "create");
    await user.click(within(dialog).getByRole("button", { name: "Save as draft" }));
    expect(await within(dialog).findByText("Enter a name.")).toBeInTheDocument();
    expect(within(dialog).getByText("Write the message.")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText(/^Name/), "Autumn offer");
    await user.type(within(dialog).getByLabelText(/^Message \(English\)/), "Come in this week.");
    await user.click(within(dialog).getByRole("button", { name: "Save as draft" }));
    await screen.findByText("Draft saved");
    const table = await screen.findByRole("table", { name: "Campaigns" });
    const row = within(table).getByRole("row", { name: /Autumn offer/ });
    expect(within(row).getByText("Draft")).toBeInTheDocument();
    expect(within(row).getByText("Everyone who agreed")).toBeInTheDocument();
    expect(within(row).getByText(/customer\(s\)/)).toBeInTheDocument();
  });

  it("sends only after a confirmation that names how many customers, and cannot send twice", async () => {
    const user = show();
    await makeDraft(user);
    const table = await screen.findByRole("table", { name: "Campaigns" });
    const spy = vi.spyOn(current.api.campaigns, "send");
    await user.click(within(table).getByRole("button", { name: /^Send/ }));
    const dialog = await screen.findByRole("dialog", { name: "Send this campaign?" });
    expect(within(dialog).getByText(/will go to \d+ customer\(s\)/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Send now" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Campaign sent")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(screen.getByRole("table", { name: "Campaigns" })).getByText("Sent"),
      ).toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole("table", { name: "Campaigns" })).queryByRole("button", {
        name: /^Send/,
      }),
    ).not.toBeInTheDocument();
  });

  it("reuses the same key when a lost answer is retried, so nothing is sent twice", async () => {
    const user = show();
    await makeDraft(user);
    const table = await screen.findByRole("table", { name: "Campaigns" });
    const real = current.api.campaigns.send;
    const keys: string[] = [];
    current.api.campaigns.send = vi.fn(async (id: string, key: string) => {
      keys.push(key);
      if (keys.length === 1) throw fail(0, "network", "NETWORK_ERROR");
      return real(id, key);
    });
    await user.click(within(table).getByRole("button", { name: /^Send/ }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Send this campaign?" })).getByRole(
        "button",
        { name: "Send now" },
      ),
    );
    await screen.findByText(en.errors.network);
    await user.click(
      within(screen.getByRole("dialog", { name: "Send this campaign?" })).getByRole("button", {
        name: "Send now",
      }),
    );
    expect(await screen.findByText("Campaign sent")).toBeInTheDocument();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("cancels a draft after a confirmation", async () => {
    const user = show();
    await makeDraft(user);
    const table = await screen.findByRole("table", { name: "Campaigns" });
    await user.click(within(table).getByRole("button", { name: /^Cancel campaign/ }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Cancel this campaign?" })).getByRole(
        "button",
        { name: "Cancel campaign" },
      ),
    );
    expect(await screen.findByText("Campaign cancelled")).toBeInTheDocument();
  });

  it("explains a refusal in words, never the backend's text", async () => {
    const user = show();
    await makeDraft(user);
    const table = await screen.findByRole("table", { name: "Campaigns" });
    current.api.campaigns.send = vi.fn().mockRejectedValue(fail(403, "forbidden", "FORBIDDEN"));
    await user.click(within(table).getByRole("button", { name: /^Send/ }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Send this campaign?" })).getByRole(
        "button",
        { name: "Send now" },
      ),
    );
    expect(await screen.findByText("Your role cannot manage campaigns.")).toBeInTheDocument();
    expect(screen.queryByText(/backend english text/)).not.toBeInTheDocument();
  });

  it("shows 'not available yet', not an error, when the service has no campaigns (production)", async () => {
    current = createMockApiFor("owner@mock.test");
    current.api.campaigns.list = vi.fn().mockRejectedValue(fail(404, "not_found", "NOT_FOUND"));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nProvider locale="en" messages={en}>
          <ToastProvider>
            <CampaignsWorkspace />
          </ToastProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Campaigns are not available yet")).toBeInTheDocument();
    expect(screen.queryByText("We could not load campaigns")).not.toBeInTheDocument();
  });

  it("reports a real failure with a retry", async () => {
    current = createMockApiFor("owner@mock.test");
    current.api.campaigns.list = vi.fn().mockRejectedValue(fail(503, "unavailable", "UNAVAILABLE"));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nProvider locale="en" messages={en}>
          <ToastProvider>
            <CampaignsWorkspace />
          </ToastProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("We could not load campaigns")).toBeInTheDocument();
  });

  it("works in Amharic", async () => {
    show("am");
    expect(await screen.findByText(am.campaigns.previewTitle)).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: am.campaigns.newCampaign }),
    ).toBeInTheDocument();
  });
});
