import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/errors/api-error";
import { I18nProvider } from "@/lib/i18n/client";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";
import { EnrollmentFlow } from "./enrollment-flow";

const enroll = vi.fn();
const claim = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => ({ enrollment: { enroll } }) }));
vi.mock("@/features/card/card-client", () => ({
  cardClient: { claim: (...args: unknown[]) => claim(...args), walletLink: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const WALLET = [
  { provider: "WEB", available: true, reason: null, addUrl: null },
  { provider: "APPLE", available: false, reason: "NOT_CONFIGURED", addUrl: null },
  { provider: "GOOGLE", available: false, reason: "NOT_CONFIGURED", addUrl: null },
];
const created = {
  status: "CREATED",
  card: { token: "tok en/1" },
  wallet: WALLET,
  customer: { firstName: "Abebe", preferredLanguage: "EN" },
};

function setup(locale: "en" | "am" = "en") {
  const user = userEvent.setup();
  render(
    <I18nProvider locale={locale} messages={locale === "en" ? en : am}>
      <EnrollmentFlow
        joinReference="sample-cafe"
        consentVersion="2026-10-v1"
        terms={{ text: "One stamp per visit.", lang: "en" }}
      />
    </I18nProvider>,
  );
  return user;
}

async function fill(user: ReturnType<typeof userEvent.setup>, phone = "0911 234 567") {
  await user.type(screen.getByLabelText(/First name/), "Abebe");
  await user.type(screen.getByLabelText(/Phone number/), phone);
}

const submit = () => screen.getByRole("button", { name: "Get my card" });
const agree = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("checkbox", { name: /agree to the terms/ }));

beforeEach(() => {
  enroll.mockReset();
  claim.mockReset();
  claim.mockResolvedValue({ id: "card-1" });
  refresh.mockReset();
});

describe("EnrollmentFlow", () => {
  it("keeps the two consents separate, with marketing off by default", () => {
    setup();
    const terms = screen.getByRole("checkbox", { name: /agree to the terms/ });
    const marketing = screen.getByRole("checkbox", { name: /offers and news/ });
    expect(terms).not.toBeChecked();
    expect(marketing).not.toBeChecked();
    expect(terms).not.toBe(marketing);
  });

  it("shows clear messages and sends nothing when the form is incomplete", async () => {
    const user = setup();
    await user.click(submit());
    expect(await screen.findByText("Enter your first name.")).toBeInTheDocument();
    expect(screen.getByText("Enter your phone number.")).toBeInTheDocument();
    expect(screen.getByText("You need to agree to the terms to join.")).toBeInTheDocument();
    expect(enroll).not.toHaveBeenCalled();
  });

  it("explains an invalid phone number without requiring the marketing consent", async () => {
    const user = setup();
    await fill(user, "0611234567");
    await agree(user);
    await user.click(submit());
    expect(await screen.findByText("Enter a valid Ethiopian phone number.")).toBeInTheDocument();
    expect(screen.queryByText(/need to agree/)).not.toBeInTheDocument();
    expect(enroll).not.toHaveBeenCalled();
  });

  it("enrolls a new customer and moves on to the wallet choice", async () => {
    enroll.mockResolvedValue(created);
    const user = setup();
    await fill(user);
    await agree(user);
    await user.click(screen.getByRole("checkbox", { name: /offers and news/ }));
    await user.click(submit());

    expect(await screen.findByText("Your card is ready")).toBeInTheDocument();
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(enroll).toHaveBeenCalledWith("sample-cafe", {
      phone: "+251911234567",
      firstName: "Abebe",
      preferredLanguage: "EN",
      acceptTerms: true,
      marketingConsent: true,
      consentVersion: "2026-10-v1",
    });
    // The token is handed to the server once; the page then refers to the card by its opaque id only.
    expect(claim).toHaveBeenCalledExactlyOnceWith("tok en/1");
    expect(await screen.findByRole("link", { name: "Open my web card" })).toHaveAttribute(
      "href",
      "/en/card?c=card-1",
    );
    expect(document.body.innerHTML).not.toContain("tok en");
    // Wallets the backend has not configured are shown, but cannot be pressed.
    expect(screen.getByRole("button", { name: "Add to Apple Wallet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add to Google Wallet" })).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("lets the customer retry when the card could not be saved, without losing it", async () => {
    enroll.mockResolvedValue(created);
    claim.mockRejectedValueOnce(
      new ApiError({ kind: "network", code: "NETWORK_ERROR", message: "x" }),
    );
    const user = setup();
    await fill(user);
    await agree(user);
    await user.click(submit());
    expect(await screen.findByText("We could not save your card")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open my web card" })).toHaveAttribute(
      "href",
      "/en/card#t=tok%20en%2F1",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("wallet-selector")).toBeInTheDocument();
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it("records the language of the page the customer chose", async () => {
    enroll.mockResolvedValue(created);
    const user = setup("am");
    await user.type(screen.getByLabelText(/የመጀመሪያ ስም/), "አበበ");
    await user.type(screen.getByLabelText(/ስልክ ቁጥር/), "911234567");
    await user.click(screen.getByRole("checkbox", { name: /በዚህ የታማኝነት ፕሮግራም/ }));
    await user.click(screen.getByRole("button", { name: "ካርዴን አግኝ" }));
    await waitFor(() => expect(enroll).toHaveBeenCalled());
    expect(enroll.mock.calls[0]![1]).toMatchObject({
      preferredLanguage: "AM",
      marketingConsent: false,
    });
  });

  it("treats an existing member kindly, without a card and without personal details", async () => {
    enroll.mockResolvedValue({ ...created, status: "EXISTING", card: null });
    const user = setup();
    await fill(user);
    await agree(user);
    await user.click(submit());
    const region = await screen.findByTestId("enrollment-existing");
    expect(within(region).getByText("You are already a member")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open my web card" })).not.toBeInTheDocument();
  });

  it("sends only one request however many times the button is pressed", async () => {
    let finish: (value: unknown) => void = () => undefined;
    enroll.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = setup();
    await fill(user);
    await agree(user);
    await user.dblClick(submit());
    await user.keyboard("{Enter}");
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Creating your card…" })).toBeDisabled();
    finish(created);
    expect(await screen.findByText("Your card is ready")).toBeInTheDocument();
  });

  it("keeps what was typed after a network failure, says what to do and allows a retry", async () => {
    enroll.mockRejectedValueOnce(
      new ApiError({ kind: "network", code: "NETWORK_ERROR", message: "offline" }),
    );
    const user = setup();
    await fill(user);
    await agree(user);
    await user.click(submit());

    expect(await screen.findByText(en.errors.network)).toBeInTheDocument();
    expect(screen.getByText(/could not confirm that your card was created/)).toBeInTheDocument();
    expect(screen.getByLabelText(/First name/)).toHaveValue("Abebe");
    expect(screen.getByRole("checkbox", { name: /agree to the terms/ })).toBeChecked();

    enroll.mockResolvedValueOnce(created);
    await user.click(submit());
    expect(await screen.findByText("Your card is ready")).toBeInTheDocument();
    expect(enroll).toHaveBeenCalledTimes(2);
  });

  it("tells a rate-limited customer how long to wait", async () => {
    enroll.mockRejectedValueOnce(
      new ApiError({
        kind: "rate_limited",
        code: "RATE_LIMITED",
        message: "slow",
        retryAfterSeconds: 20,
      }),
    );
    const user = setup();
    await fill(user);
    await agree(user);
    await user.click(submit());
    expect(await screen.findByText(/try again in 20 seconds/)).toBeInTheDocument();
  });

  it("puts a server-side phone rejection next to the phone field", async () => {
    enroll.mockRejectedValueOnce(
      new ApiError({
        kind: "validation",
        code: "VALIDATION_FAILED",
        message: "bad",
        fieldErrors: { phone: "phone must be a valid Ethiopian mobile number" },
      }),
    );
    const user = setup();
    await fill(user);
    await agree(user);
    await user.click(submit());
    expect(await screen.findByText("Enter a valid Ethiopian phone number.")).toBeInTheDocument();
  });

  it("makes the customer agree again when the terms changed", async () => {
    enroll.mockRejectedValueOnce(
      new ApiError({
        kind: "conflict",
        code: "CONSENT_VERSION_STALE",
        message: "stale",
        status: 409,
      }),
    );
    const user = setup();
    await fill(user);
    await agree(user);
    await user.click(submit());
    expect(await screen.findByText(en.enrollment.consentStale)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /agree to the terms/ })).not.toBeChecked();
    expect(refresh).toHaveBeenCalled();
  });
});
