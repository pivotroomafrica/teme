import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import type { Program } from "@/lib/api/contract";
import { ApiError } from "@/lib/errors/api-error";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/messages/en";
import { seedPrograms } from "@/mocks/program-data";
import { ProgramWorkspace } from "./program-workspace";

const list = vi.fn();
const create = vi.fn();
const update = vi.fn();
const activate = vi.fn();
const pause = vi.fn();
const archive = vi.fn();

vi.mock("@/lib/api/browser", () => ({
  getBrowserApi: () => ({ programs: { list, create, update, activate, pause, archive } }),
}));

const MERCHANT = { nameEn: "Sample Cafe", nameAm: "ናሙና ቡና ቤት" };
const POSTER = { en: en.poster, am: en.poster } as never;

const base = (): Program => structuredClone(seedPrograms()[0]!);
const draft = (): Program => ({
  ...base(),
  id: "draft-1",
  status: "DRAFT",
  isDefault: false,
  nameEn: "Spring Card",
  memberCount: 0,
  stampsRequiredLocked: false,
});

function show(options: { canManage?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en" messages={en}>
        <ToastProvider>
          <ProgramWorkspace
            canManage={options.canManage ?? true}
            merchant={MERCHANT}
            codes={null}
            posterMessages={POSTER}
          />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return user;
}

// Required fields add "(required)" to their name for screen readers, so match the start of the label.
const field = (label: string) =>
  screen.getByRole("textbox", { name: new RegExp(`^${label.replace(/[()]/g, "\\$&")}`) });
// The list is asked for again after a change; from then on the backend answers with the new state.
const afterChange = (before: Program, after: Program) => {
  list.mockResolvedValueOnce([before]);
  list.mockResolvedValue([after]);
};
const save = () => screen.getByRole("button", { name: /^(Save changes|Save draft|Create draft)$/ });

beforeEach(() => {
  for (const mock of [list, create, update, activate, pause, archive]) mock.mockReset();
  list.mockResolvedValue([base()]);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});

describe("loading the programs", () => {
  it("shows the program and its status once loaded", async () => {
    show();
    expect(await screen.findByRole("heading", { name: "Coffee Card" })).toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("12 members")).toBeInTheDocument();
  });

  it("explains a backend that is unavailable and lets the person retry", async () => {
    list.mockRejectedValueOnce(
      new ApiError({ kind: "unavailable", code: "HTTP_503", message: "x", requestId: "req-9" }),
    );
    const user = show();
    expect(await screen.findByText("We could not load your programs")).toBeInTheDocument();
    expect(screen.getByText("req-9")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Coffee Card" })).toBeInTheDocument();
  });

  it("invites an owner with no program to create one, and tells a reader there is none", async () => {
    list.mockResolvedValue([]);
    show({ canManage: true });
    expect(await screen.findByText("You have no loyalty program yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create draft" })).toBeInTheDocument();
  });

  it("shows a reader with no program nothing to edit", async () => {
    list.mockResolvedValue([]);
    show({ canManage: false });
    expect(await screen.findByText("You have no loyalty program yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create draft" })).not.toBeInTheDocument();
  });
});

describe("permission restrictions", () => {
  it("makes every field read-only and offers no save or status buttons without program:manage", async () => {
    show({ canManage: false });
    await screen.findByRole("heading", { name: "Coffee Card" });
    expect(screen.getByText(/You can look at this program but not change it/)).toBeInTheDocument();
    expect(field("Program name (English)")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
    for (const name of ["Publish", "Pause", "Archive", "New program"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("makes an archived program read-only for everyone, and says nothing was deleted", async () => {
    list.mockResolvedValue([{ ...base(), status: "ARCHIVED", isDefault: false }]);
    show();
    await screen.findByRole("heading", { name: "Coffee Card" });
    expect(screen.getByText(/archived and cannot be changed/)).toBeInTheDocument();
    expect(field("Program name (English)")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Save|Pause|Archive/ })).not.toBeInTheDocument();
  });
});

describe("editing and saving", () => {
  it("shows the backend's own limits as instant messages and sends nothing when invalid", async () => {
    const user = show();
    await screen.findByRole("heading", { name: "Coffee Card" });
    await user.clear(field("Program name (English)"));
    await user.click(save());
    expect(await screen.findByText("Enter a name.")).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("starts with Save disabled and enables it only when something changed", async () => {
    const user = show();
    await screen.findByRole("heading", { name: "Coffee Card" });
    expect(save()).toBeDisabled();
    await user.type(field("Program name (English)"), "!");
    await waitFor(() => expect(save()).toBeEnabled());
  });

  it("locks the stamp requirement once customers have joined, with the reason", async () => {
    show();
    await screen.findByRole("heading", { name: "Coffee Card" });
    expect(screen.getByRole("textbox", { name: /Stamps needed/ })).toBeDisabled();
    expect(screen.getByText(/because 12 customers have joined/)).toBeInTheDocument();
  });

  it("sends only the changed field, after warning that members will see the change", async () => {
    update.mockImplementation(async (_id, patch) => ({
      ...base(),
      ...patch,
      nameEn: patch.nameEn ?? base().nameEn,
    }));
    const user = show();
    await screen.findByRole("heading", { name: "Coffee Card" });
    await user.clear(field("Program name (English)"));
    await user.type(field("Program name (English)"), "Coffee Club");
    await user.click(save());

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("These changes reach 12 members")).toBeInTheDocument();
    expect(within(dialog).getByText(/What changes: name/)).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Save and update cards" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(base().id, { nameEn: "Coffee Club" });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("changes nothing when the warning is cancelled", async () => {
    const user = show();
    await screen.findByRole("heading", { name: "Coffee Card" });
    await user.type(field("Program name (English)"), "!");
    await user.click(save());
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(update).not.toHaveBeenCalled();
    expect(field("Program name (English)")).toHaveValue("Coffee Card!");
  });

  it("saves without a warning when no member exists yet", async () => {
    list.mockResolvedValue([draft()]);
    update.mockImplementation(async (_id, patch) => ({ ...draft(), ...patch }));
    const user = show();
    await screen.findByRole("heading", { name: "Spring Card" });
    await user.type(field("Program name (English)"), " 2");
    await user.click(save());
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("draft-1", { nameEn: "Spring Card 2" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains a locked stamp requirement refused by the backend", async () => {
    // The page believes it can change the number; the backend knows better and has the last word.
    list.mockResolvedValue([{ ...base(), stampsRequiredLocked: false }]);
    update.mockRejectedValue(
      new ApiError({ kind: "conflict", code: "PROGRAM_LOCKED", message: "x", status: 409 }),
    );
    const user = show();
    await screen.findByRole("heading", { name: "Coffee Card" });
    await user.clear(screen.getByRole("textbox", { name: /Stamps needed/ }));
    await user.type(screen.getByRole("textbox", { name: /Stamps needed/ }), "10");
    await user.click(save());
    expect(
      await screen.findByText(/can no longer change because customers have joined/),
    ).toBeInTheDocument();
  });

  it("puts a backend field error next to the field", async () => {
    list.mockResolvedValue([draft()]);
    update.mockRejectedValue(
      new ApiError({
        kind: "validation",
        code: "VALIDATION_FAILED",
        message: "bad",
        fieldErrors: {
          "reward.nameEn": "reward.nameEn must be shorter than or equal to 120 characters",
        },
      }),
    );
    const user = show();
    await screen.findByRole("heading", { name: "Spring Card" });
    await user.type(field("Reward (English)"), "!");
    await user.click(save());
    expect(await screen.findByText(/reward.nameEn must be shorter/)).toBeInTheDocument();
    expect(screen.getByText("Please check the highlighted fields.")).toBeInTheDocument();
  });
});

describe("creating a draft", () => {
  it("creates a draft with the backend's field names and shows it", async () => {
    list.mockResolvedValue([]);
    create.mockImplementation(async (input) => ({ ...draft(), nameEn: input.nameEn, id: "new-1" }));
    const user = show();
    await screen.findByText("You have no loyalty program yet.");
    await user.type(field("Program name (English)"), "Winter Card");
    await user.type(field("Reward (English)"), "Free tea");
    await user.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({
      nameEn: "Winter Card",
      stampsRequired: 8,
      cooldownMinutes: 120,
      reward: { nameEn: "Free tea", validForDays: null },
    });
    expect(await screen.findByText("Draft created.")).toBeInTheDocument();
  });

  it("refuses to create without a name and a reward", async () => {
    list.mockResolvedValue([]);
    const user = show();
    await screen.findByText("You have no loyalty program yet.");
    await user.click(screen.getByRole("button", { name: "Create draft" }));
    expect((await screen.findAllByText("Enter a name.")).length).toBe(2);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("publishing, pausing and archiving", () => {
  it("publishes a saved draft only after confirmation, and shows what the backend returned", async () => {
    afterChange(draft(), { ...draft(), status: "ACTIVE", isDefault: true });
    activate.mockResolvedValue({ ...draft(), status: "ACTIVE", isDefault: true });
    const user = show();
    await screen.findByRole("heading", { name: "Spring Card" });
    await user.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Publish this program?")).toBeInTheDocument();
    expect(activate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(activate).toHaveBeenCalledWith("draft-1"));
    await waitFor(() => expect(screen.getAllByText("Active").length).toBeGreaterThan(0));
  });

  it("will not publish while there are unsaved changes", async () => {
    list.mockResolvedValue([draft()]);
    const user = show();
    await screen.findByRole("heading", { name: "Spring Card" });
    await user.type(field("Program name (English)"), "!");
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.getByText("Save your changes before publishing.")).toBeInTheDocument();
  });

  it("warns when another program is already live, and still lets the backend decide", async () => {
    list.mockResolvedValue([base(), draft()]);
    activate.mockRejectedValue(
      new ApiError({ kind: "conflict", code: "DEFAULT_PROGRAM_EXISTS", message: "x", status: 409 }),
    );
    const user = show();
    await screen.findByRole("heading", { name: "Coffee Card" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Program" }), "draft-1");
    expect(await screen.findByText(/Another program is active/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Publish" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish" }),
    );
    expect(
      await screen.findByText(/Another program is already the active one/),
    ).toBeInTheDocument();
  });

  it("explains an incomplete program refused by the backend", async () => {
    list.mockResolvedValue([draft()]);
    activate.mockRejectedValue(
      new ApiError({ kind: "conflict", code: "PROGRAM_INCOMPLETE", message: "x", status: 409 }),
    );
    const user = show();
    await screen.findByRole("heading", { name: "Spring Card" });
    await user.click(screen.getByRole("button", { name: "Publish" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish" }),
    );
    expect(
      await screen.findByText(/needs a reward before it can be published/),
    ).toBeInTheDocument();
  });

  it("pauses an active program after confirmation, saying members keep everything", async () => {
    afterChange(base(), { ...base(), status: "PAUSED" });
    pause.mockResolvedValue({ ...base(), status: "PAUSED" });
    const user = show();
    await screen.findByRole("heading", { name: "Coffee Card" });
    await user.click(screen.getByRole("button", { name: "Pause" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/Existing members, stamps and rewards stay as they are/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(pause).toHaveBeenCalledWith(base().id));
    expect(await screen.findByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("resumes a paused program", async () => {
    list.mockResolvedValue([{ ...base(), status: "PAUSED" }]);
    activate.mockResolvedValue(base());
    const user = show();
    await screen.findByRole("heading", { name: "Coffee Card" });
    await user.click(screen.getByRole("button", { name: "Resume" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Resume" }),
    );
    await waitFor(() => expect(activate).toHaveBeenCalled());
  });

  it("archives only after the person types the word, and says it is final", async () => {
    afterChange(base(), { ...base(), status: "ARCHIVED", isDefault: false });
    archive.mockResolvedValue({ ...base(), status: "ARCHIVED", isDefault: false });
    const user = show();
    await screen.findByRole("heading", { name: "Coffee Card" });
    await user.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/This is final\. Nothing is deleted/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Archive" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox"), "ARCHIVE");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/archived and cannot be changed/)).toBeInTheDocument();
  });

  it("shows the backend's refusal of an impossible move", async () => {
    pause.mockRejectedValue(
      new ApiError({ kind: "conflict", code: "INVALID_TRANSITION", message: "x", status: 409 }),
    );
    const user = show();
    await screen.findByRole("heading", { name: "Coffee Card" });
    await user.click(screen.getByRole("button", { name: "Pause" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Pause" }),
    );
    expect(await screen.findByText(/cannot be moved to that state/)).toBeInTheDocument();
  });
});

describe("unsaved changes", () => {
  it("warns before a tab is closed and says so on screen, then stops warning after saving", async () => {
    list.mockResolvedValue([draft()]);
    update.mockImplementation(async (_id, patch) => ({ ...draft(), ...patch }));
    const user = show();
    await screen.findByRole("heading", { name: "Spring Card" });

    const quiet = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);

    await user.type(field("Program name (English)"), "!");
    expect(await screen.findByText("You have unsaved changes.")).toBeInTheDocument();
    const loud = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(loud);
    expect(loud.defaultPrevented).toBe(true);

    await user.click(save());
    await waitFor(() => expect(update).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText("You have unsaved changes.")).not.toBeInTheDocument(),
    );
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("asks before following a link to another page, and stays if the person says no", async () => {
    list.mockResolvedValue([draft()]);
    const user = show();
    await screen.findByRole("heading", { name: "Spring Card" });
    await user.type(field("Program name (English)"), "!");
    const link = document.body.appendChild(
      Object.assign(document.createElement("a"), {
        href: "/en/dashboard/team",
        textContent: "Team",
      }),
    );
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    expect(window.confirm).toHaveBeenCalledWith("You have unsaved changes. Leave without saving?");
    expect(click.defaultPrevented).toBe(true);
    link.remove();
  });

  it("discards changes on request", async () => {
    list.mockResolvedValue([draft()]);
    const user = show();
    await screen.findByRole("heading", { name: "Spring Card" });
    await user.type(field("Program name (English)"), "!!!");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(field("Program name (English)")).toHaveValue("Spring Card");
  });
});

describe("live previews", () => {
  it("shows the draft as typed, before it is saved, on the join page, web card and wallet card", async () => {
    list.mockResolvedValue([draft()]);
    const user = show();
    await screen.findByRole("heading", { name: "Spring Card" });
    const previews = screen.getByTestId("previews");
    expect(within(previews).queryByTestId("preview-draft")).not.toBeInTheDocument();

    await user.clear(field("Program name (English)"));
    await user.type(field("Program name (English)"), "Brand New Name");
    expect(within(previews).getByTestId("preview-draft")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("preview-join")).getByText("Brand New Name"),
    ).toBeInTheDocument();

    await user.click(within(previews).getByRole("tab", { name: "Web card" }));
    expect(
      within(screen.getByTestId("preview-web")).getByText("Brand New Name"),
    ).toBeInTheDocument();
    await user.click(within(previews).getByRole("tab", { name: "Wallet card" }));
    // On the wallet card the card title, when there is one, takes the place of the program name.
    await user.clear(field("Card title"));
    await user.type(field("Card title"), "Spring pass");
    expect(
      within(screen.getByTestId("preview-wallet")).getByText("Spring pass"),
    ).toBeInTheDocument();
  });

  it("uses the colour, card title and progress text from the form", async () => {
    list.mockResolvedValue([draft()]);
    const user = show();
    await screen.findByRole("heading", { name: "Spring Card" });
    await user.click(screen.getByRole("tab", { name: "Wallet card" }));
    const wallet = screen.getByTestId("preview-wallet");
    expect(within(wallet).getByText("Coffee card")).toBeInTheDocument(); // the card title
    expect(wallet).toHaveStyle({ backgroundColor: "rgb(27, 94, 58)" });
    expect(screen.getByTestId("wallet-progress-text")).toHaveTextContent("3 of 8 stamps");

    fireEvent.change(screen.getByLabelText("Brand colour", { selector: "input[type=color]" }), {
      target: { value: "#aa0000" },
    });
    await waitFor(() => expect(wallet).toHaveStyle({ backgroundColor: "rgb(170, 0, 0)" }));

    await user.click(screen.getByRole("checkbox", { name: /Show the stamp count/ }));
    expect(screen.queryByTestId("wallet-progress-text")).not.toBeInTheDocument();
  });

  it("shows the business's Amharic wording when the preview language is Amharic", async () => {
    list.mockResolvedValue([draft()]);
    const user = show();
    await screen.findByRole("heading", { name: "Spring Card" });
    await user.click(
      within(screen.getByTestId("previews")).getByRole("radio", { name: "Amharic" }),
    );
    expect(within(screen.getByTestId("preview-join")).getByText(/ነጻ ቡና/)).toBeInTheDocument();
  });

  it("uses a safe placeholder for an empty name instead of a blank card", async () => {
    list.mockResolvedValue([]);
    show();
    await screen.findByText("You have no loyalty program yet.");
    expect(
      within(screen.getByTestId("preview-join")).getByText("Your program name"),
    ).toBeInTheDocument();
  });
});
