import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import { ApiError } from "@/lib/errors/api-error";
import { I18nProvider } from "@/lib/i18n/client";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";
import { profileFor, updateProfile } from "@/mocks/settings-data";
import { createMockApiFor } from "@/mocks/test-api";
import { patchFrom, valuesFrom } from "../settings-rules";
import { SettingsForm } from "./settings-form";

let current: ReturnType<typeof createMockApiFor>;
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => current.api }));

function show(canEdit = true, locale: "en" | "am" = "en") {
  current = createMockApiFor("owner@mock.test");
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider locale={locale} messages={locale === "en" ? en : am}>
        <ToastProvider>
          <SettingsForm canEdit={canEdit} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return user;
}

const ready = () => screen.findByLabelText(/^Business name \(English\)/);

beforeEach(() => vi.clearAllMocks());

describe("changed fields", () => {
  const profile = profileFor(new Map(), "x");
  const before = valuesFrom(profile);

  it("sends nothing when nothing changed", () => {
    expect(patchFrom(before, { ...before })).toEqual({});
  });

  it("sends only what changed, and null for an emptied optional field", () => {
    const patch = patchFrom(before, {
      ...before,
      nameAm: "",
      supportPhone: "0911 234 567",
      defaultStampsRequired: "10",
    });
    expect(patch).toEqual({
      nameAm: null,
      supportPhone: "0911 234 567",
      defaultStampsRequired: 10,
    });
  });
});

describe("mock profile rules", () => {
  it("applies a partial update and rejects bad values with a list of problems", () => {
    const profile = profileFor(new Map(), "a");
    expect(updateProfile(profile, { nameEn: "New Cafe", supportPhone: "0911234567" }).status).toBe(
      200,
    );
    expect(profile.nameEn).toBe("New Cafe");
    expect(profile.supportPhone).toBe("+251911234567");
    expect(profile.timezone).toBe("Africa/Addis_Ababa");
    const bad = updateProfile(profile, {
      nameEn: "",
      timezone: "Mars/Olympus",
      supportEmail: "nope",
      defaultStampsRequired: 0,
      defaultCooldownMinutes: 99999,
    });
    expect(bad.status).toBe(400);
    expect((bad.body as { error: { details: string[] } }).error.details).toHaveLength(5);
    expect(profile.nameEn).toBe("New Cafe");
  });
});

describe("settings screen", () => {
  it("shows the saved values, the join reference and the status, and explains the logo", async () => {
    show();
    expect(await ready()).toHaveValue("Sample Cafe");
    expect(screen.getByLabelText(/^Support email/)).toHaveValue("hello@sample-cafe.example");
    expect(screen.getByText("sample-cafe", { selector: "dd.font-mono" })).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/Logos cannot be uploaded yet/)).toBeInTheDocument();
  });

  it("saves only the changed fields and shows the saved profile", async () => {
    const user = show();
    const name = await ready();
    const spy = vi.spyOn(current.api.merchant, "updateProfile");
    await user.clear(name);
    await user.type(name, "Sample Cafe Bole");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0]![0]).toEqual({ nameEn: "Sample Cafe Bole" });
    expect(await screen.findByText("Settings saved")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText(/^Business name \(English\)/)).toHaveValue("Sample Cafe Bole"),
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("clears an optional field by sending null", async () => {
    const user = show();
    await ready();
    const spy = vi.spyOn(current.api.merchant, "updateProfile");
    await user.clear(screen.getByLabelText(/^Support email/));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![0]).toEqual({ supportEmail: null });
  });

  it("checks the values before asking the backend", async () => {
    const user = show();
    await ready();
    const spy = vi.spyOn(current.api.merchant, "updateProfile");
    await user.clear(screen.getByLabelText(/^Business name \(English\)/));
    await user.clear(screen.getByLabelText(/^Stamps needed/));
    await user.type(screen.getByLabelText(/^Stamps needed/), "5000");
    await user.type(screen.getByLabelText(/^Support phone/), "12");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Enter the business name.")).toBeInTheDocument();
    expect(screen.getByText("Enter a whole number from 1 to 1000.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid Ethiopian phone number.")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("warns that a new time zone changes how past days and months are counted", async () => {
    const user = show();
    await ready();
    await user.selectOptions(screen.getByLabelText(/^Time zone/), "Africa/Nairobi");
    expect(screen.getByText(/including past reports/)).toBeInTheDocument();
  });

  it("explains a refusal in words, never the backend's text", async () => {
    const user = show();
    await ready();
    current.api.merchant.updateProfile = vi.fn().mockRejectedValue(
      new ApiError({
        kind: "forbidden",
        code: "FORBIDDEN",
        status: 403,
        message: "backend english text",
      }),
    );
    await user.type(screen.getByLabelText(/^Support email/), "x");
    await user.clear(screen.getByLabelText(/^Support email/));
    await user.type(screen.getByLabelText(/^Support email/), "me@example.org");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Your role cannot change these settings.")).toBeInTheDocument();
    expect(screen.queryByText(/backend english text/)).not.toBeInTheDocument();
  });

  it("is read-only without permission", async () => {
    show(false);
    expect(await ready()).toBeDisabled();
    expect(screen.getByText(/can see these settings but not change them/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("works in Amharic", async () => {
    show(true, "am");
    expect(
      await screen.findByLabelText(new RegExp(`^${am.settings.nameEn.replace(/[()]/g, "\\$&")}`)),
    ).toBeInTheDocument();
    expect(screen.getByText(am.settings.logoNote)).toBeInTheDocument();
  });
});
