import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";
import { createMockApiFor } from "@/mocks/test-api";
import { orgFor } from "@/mocks/org-data";
import { AcceptInvitationForm } from "./accept-invitation-form";

let current: ReturnType<typeof createMockApiFor>;
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => current.api }));

const GOOD = "a-long-password-1";

/** An owner invites someone through the real client; the code is what the owner would hand over. */
async function invite() {
  current = createMockApiFor("owner@mock.test");
  const branch = orgFor(current.state.orgs, "owner@mock.test").branches[0]!;
  const result = await current.api.team.invite({
    email: "new.person@example.org",
    displayName: "New Person",
    role: "STAFF",
    branchIds: [branch.id],
    language: "EN",
  } as never);
  return { code: result.invitation.token, staffId: result.staff.id };
}

function show(locale: "en" | "am" = "en") {
  const user = userEvent.setup();
  render(
    <I18nProvider locale={locale} messages={locale === "en" ? en : am}>
      <AcceptInvitationForm />
    </I18nProvider>,
  );
  return user;
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  code: string,
  password: string,
  confirm = password,
) {
  await user.type(screen.getByLabelText(/^Invitation code/), code);
  await user.type(screen.getByLabelText(/^Choose a password/), password);
  await user.type(screen.getByLabelText(/^Type the password again/), confirm);
  await user.click(screen.getByRole("button", { name: "Set password" }));
}

beforeEach(() => {
  current = createMockApiFor("owner@mock.test");
});

describe("accepting an invitation", () => {
  it("sets the password with a valid code and offers sign-in", async () => {
    const { code, staffId } = await invite();
    const user = show();
    await fill(user, code, GOOD);
    expect(await screen.findByTestId("invitation-accepted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
      "href",
      "/en/login",
    );
    const person = orgFor(current.state.orgs, "owner@mock.test").staff.find(
      (s) => s.id === staffId,
    );
    expect(person?.status).toBe("ACTIVE");
  });

  it("checks the password rules before asking the backend", async () => {
    const { code } = await invite();
    const spy = vi.spyOn(current.api.auth, "acceptInvitation");
    const user = show();
    await fill(user, code, "short1");
    expect(await screen.findByText("Use at least 12 characters.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/^Choose a password/));
    await user.type(screen.getByLabelText(/^Choose a password/), "onlyletterslongenough");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(
      await screen.findByText("Include at least one letter and one number."),
    ).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("requires the two passwords to match", async () => {
    const { code } = await invite();
    const user = show();
    await fill(user, code, GOOD, "a-long-password-2");
    expect(await screen.findByText("The two passwords are not the same.")).toBeInTheDocument();
  });

  it("answers an unknown code and a reused code in the same words, without revealing which", async () => {
    const { code } = await invite();
    const user = show();
    await fill(user, "inv_not-a-real-code", GOOD);
    const wrong = await screen.findByText(en.auth.acceptInvalid);
    expect(wrong).toBeInTheDocument();

    // The real code works once; using it again gets the same answer.
    await user.clear(screen.getByLabelText(/^Invitation code/));
    await user.type(screen.getByLabelText(/^Invitation code/), code);
    await user.click(screen.getByRole("button", { name: "Set password" }));
    await screen.findByTestId("invitation-accepted");
    expect(
      (await current.api.auth.acceptInvitation({ token: code, password: GOOD }).catch((e) => e))
        .code,
    ).toBe("INVALID_INVITATION");
  });

  it("makes an older code useless once a new one is issued", async () => {
    const { code, staffId } = await invite();
    const fresh = await current.api.team.reissueInvitation(staffId);
    await expect(
      current.api.auth.acceptInvitation({ token: code, password: GOOD }),
    ).rejects.toMatchObject({
      code: "INVALID_INVITATION",
    });
    await expect(
      current.api.auth.acceptInvitation({ token: fresh.token, password: GOOD }),
    ).resolves.toBeUndefined();
  });

  it("keeps the code and password out of the address and out of browser storage", async () => {
    const { code } = await invite();
    const user = show();
    await fill(user, code, GOOD);
    await screen.findByTestId("invitation-accepted");
    expect(window.location.href).not.toContain(code);
    expect(window.location.href).not.toContain(GOOD);
    expect(JSON.stringify({ ...localStorage })).not.toContain(code);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(GOOD);
  });

  it("works in Amharic", async () => {
    show("am");
    expect(screen.getByLabelText(new RegExp(`^${am.auth.acceptCode}`))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: am.auth.acceptSubmit })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Invitation code")).not.toBeInTheDocument());
  });
});
