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
import { DEFAULTS, fraudFor, listFlags, reviewFlag, updateThresholds } from "@/mocks/fraud-data";
import { createMockApiFor } from "@/mocks/test-api";
import { INDICATORS, draftFrom, fieldProblem, thresholdPatch } from "../thresholds";
import { FraudWorkspace } from "./fraud-workspace";

let current: ReturnType<typeof createMockApiFor>;
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => current.api }));

function show(email: MockEmail = "owner@mock.test", locale: "en" | "am" = "en") {
  current = createMockApiFor(email);
  const canManage = (MOCK_ACCOUNTS[email].permissions as readonly string[]).includes(
    "fraud:manage",
  );
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider locale={locale} messages={locale === "en" ? en : am}>
        <ToastProvider>
          <FraudWorkspace canManage={canManage} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return user;
}

const table = () => screen.findByRole("table", { name: "Flags" });
const fail = (status: number, kind: ApiError["kind"], code: string) =>
  new ApiError({ kind, code, status, message: "backend english text" });

beforeEach(() => vi.clearAllMocks());

describe("threshold rules", () => {
  it("mirrors the backend's ranges and detects problems", () => {
    const humanWindow = INDICATORS[0]!.fields[0]!;
    expect(fieldProblem(humanWindow, "60")).toBe(false);
    expect(fieldProblem(humanWindow, "4")).toBe(true);
    expect(fieldProblem(humanWindow, "60.5")).toBe(true);
    expect(fieldProblem(humanWindow, "")).toBe(true);
    const ratio = INDICATORS.find((i) => i.key === "highReversalRate")!.fields.find(
      (f) => f.name === "maxRatio",
    )!;
    expect(fieldProblem(ratio, "0.2")).toBe(false);
    expect(fieldProblem(ratio, "1.5")).toBe(true);
  });

  it("builds a partial, nested patch of only what changed", () => {
    const before = draftFrom(DEFAULTS as never);
    const after = structuredClone(before);
    after.excessiveStampsPerStaff!.maxStamps = "60";
    after.highReversalRate!.enabled = false;
    expect(thresholdPatch(before, after)).toEqual({
      excessiveStampsPerStaff: { maxStamps: 60 },
      highReversalRate: { enabled: false },
    });
    expect(thresholdPatch(before, before)).toEqual({});
  });
});

describe("mock fraud rules", () => {
  it("lets a flag be reviewed once, with a note of at most 500 characters", () => {
    const data = fraudFor(new Map(), "a");
    const open = data.flags.find((f) => f.status === "OPEN")!;
    expect(reviewFlag(data, open.id, { status: "DISMISSED", note: "x".repeat(501) }).status).toBe(
      400,
    );
    expect(reviewFlag(data, open.id, { status: "MAYBE" }).status).toBe(400);
    expect(reviewFlag(data, open.id, { status: "CONFIRMED", note: "Checked." }).status).toBe(200);
    expect(reviewFlag(data, open.id, { status: "DISMISSED" }).status).toBe(409);
    expect(
      reviewFlag(data, "00000000-0000-4000-8000-000000000000", { status: "DISMISSED" }).status,
    ).toBe(404);
  });

  it("rejects out-of-range limits and keeps the old ones", () => {
    const data = fraudFor(new Map(), "b");
    expect(updateThresholds(data, { excessiveStampsPerStaff: { maxStamps: 0 } }).status).toBe(400);
    expect(updateThresholds(data, { nonsense: { a: 1 } }).status).toBe(400);
    expect(data.thresholds.excessiveStampsPerStaff).toEqual(DEFAULTS.excessiveStampsPerStaff);
    expect(updateThresholds(data, { excessiveStampsPerStaff: { maxStamps: 55 } }).status).toBe(200);
    expect((data.thresholds.excessiveStampsPerStaff as Record<string, unknown>).maxStamps).toBe(55);
  });

  it("pages and filters flags", () => {
    const data = fraudFor(new Map(), "c");
    const first = listFlags(data, { limit: 10 }).body as {
      items: unknown[];
      nextCursor: string | null;
    };
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).toBe("10");
    const open = (
      listFlags(data, { status: "OPEN", limit: 100 }).body as { items: Array<{ status: string }> }
    ).items;
    expect(open.every((f) => f.status === "OPEN")).toBe(true);
  });
});

describe("flags", () => {
  it("lists flags in words, 10 per page, with what was measured against the limit", async () => {
    const user = show();
    const flags = await table();
    expect(within(flags).getAllByRole("row")).toHaveLength(11);
    expect(within(flags).getAllByText("Many stamps from one team member").length).toBeGreaterThan(
      0,
    );
    expect(within(flags).getAllByText("52 (limit 40)").length).toBeGreaterThan(0);
    expect(within(flags).getAllByText(/31% \(limit 20%\)/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Nothing is blocked, suspended or reported automatically/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Showing 11–14")).toBeInTheDocument());
  });

  it("filters by status and explains when nothing matches", async () => {
    const user = show();
    await table();
    await user.selectOptions(screen.getByLabelText("Status"), "Looks genuine");
    await waitFor(async () => {
      const rows = within(await table())
        .getAllByRole("row")
        .slice(1);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(within(row).getByText("Looks genuine")).toBeInTheDocument();
    });
    current.api.fraud.flags = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    await user.selectOptions(
      screen.getByLabelText("What was noticed"),
      "A branch much busier than usual",
    );
    expect(await screen.findByText("No flags match these filters.")).toBeInTheDocument();
  });

  it("lets an owner review a flag once, with a verdict and an optional note", async () => {
    const user = show();
    const flags = await table();
    const spy = vi.spyOn(current.api.fraud, "review");
    await user.click(within(flags).getAllByRole("button", { name: /Review/ })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Review this flag" });
    expect(within(dialog).getByText(/nobody is penalised, suspended or told/)).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("Your verdict"), "Looks genuine");
    await user.type(within(dialog).getByLabelText(/Note/), "Spoke to the branch.");
    await user.click(within(dialog).getByRole("button", { name: "Record verdict" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0]![1]).toEqual({ status: "CONFIRMED", note: "Spoke to the branch." });
    expect(await screen.findByText("Verdict recorded")).toBeInTheDocument();
  });

  it("explains a flag that someone else already reviewed, and a refusal", async () => {
    const user = show();
    const flags = await table();
    current.api.fraud.review = vi
      .fn()
      .mockRejectedValueOnce(fail(409, "conflict", "ALREADY_REVIEWED"));
    await user.click(within(flags).getAllByRole("button", { name: /Review/ })[0]!);
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Record verdict" }),
    );
    expect(await screen.findByText("This flag was already reviewed.")).toBeInTheDocument();
    current.api.fraud.review = vi.fn().mockRejectedValueOnce(fail(403, "forbidden", "FORBIDDEN"));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Record verdict" }),
    );
    expect(await screen.findByText("Only owners can review flags.")).toBeInTheDocument();
    expect(screen.queryByText(/backend english text/)).not.toBeInTheDocument();
  });

  it("does not offer review or running the checks to a manager", async () => {
    show("manager@mock.test");
    const flags = await table();
    expect(within(flags).queryByRole("button", { name: /Review/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run the checks now" })).not.toBeInTheDocument();
  });

  it("runs the checks and shows the new flag", async () => {
    const user = show();
    await table();
    await user.click(screen.getByRole("button", { name: "Run the checks now" }));
    expect(
      await screen.findByText("The checks ran. 1 new flag(s) were raised."),
    ).toBeInTheDocument();
  });

  it("explains a failed load in words with a retry", async () => {
    current = createMockApiFor("owner@mock.test");
    current.api.fraud.flags = vi.fn().mockRejectedValue(fail(503, "unavailable", "UNAVAILABLE"));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nProvider locale="en" messages={en}>
          <ToastProvider>
            <FraudWorkspace canManage />
          </ToastProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("We could not load the flags")).toBeInTheDocument();
    expect(screen.queryByText(/backend english text/)).not.toBeInTheDocument();
  });
});

describe("limits", () => {
  async function openLimits(user: ReturnType<typeof userEvent.setup>) {
    await table();
    await user.click(screen.getByRole("tab", { name: "Limits" }));
    return screen.findByRole("group", { name: "Many stamps from one team member" });
  }

  it("shows the limits with their allowed ranges", async () => {
    const user = show();
    const group = await openLimits(user);
    expect(within(group).getByLabelText(/Most stamps/)).toHaveValue("40");
    expect(within(group).getAllByText("Between 1 and 100,000").length).toBeGreaterThan(0);
  });

  it("saves only the changed limit", async () => {
    const user = show();
    const group = await openLimits(user);
    const spy = vi.spyOn(current.api.fraud, "updateThresholds");
    const field = within(group).getByLabelText(/Most stamps/);
    await user.clear(field);
    await user.type(field, "55");
    await user.click(screen.getByRole("button", { name: "Save limits" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0]![0]).toEqual({ excessiveStampsPerStaff: { maxStamps: 55 } });
    expect(await screen.findByText("Limits saved")).toBeInTheDocument();
  });

  it("refuses a value outside its range before asking the backend", async () => {
    const user = show();
    const group = await openLimits(user);
    const spy = vi.spyOn(current.api.fraud, "updateThresholds");
    const field = within(group).getByLabelText(/Most stamps/);
    await user.clear(field);
    await user.type(field, "0");
    await user.click(screen.getByRole("button", { name: "Save limits" }));
    expect(
      await screen.findAllByText("One of the limits is outside its allowed range."),
    ).not.toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("can switch a check off", async () => {
    const user = show();
    const group = await openLimits(user);
    const spy = vi.spyOn(current.api.fraud, "updateThresholds");
    await user.click(within(group).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Save limits" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![0]).toEqual({ excessiveStampsPerStaff: { enabled: false } });
  });

  it("is read-only for a manager", async () => {
    const user = show("manager@mock.test");
    const group = await openLimits(user);
    expect(within(group).getByLabelText(/Most stamps/)).toBeDisabled();
    expect(screen.getByText(/only owners can change them/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save limits" })).not.toBeInTheDocument();
  });
});

describe("language", () => {
  it("works in Amharic", async () => {
    show("owner@mock.test", "am");
    expect(
      await screen.findByRole("table", { name: am.fraud.flagsTableLabel }),
    ).toBeInTheDocument();
    expect(screen.getByText(am.fraud.intro)).toBeInTheDocument();
  });
});
