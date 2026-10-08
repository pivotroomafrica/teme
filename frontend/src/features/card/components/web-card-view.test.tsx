import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import type { WebCard } from "@/lib/api/contract";
import { createFormatter } from "@/lib/i18n/format";
import { I18nProvider } from "@/lib/i18n/client";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";
import { createTranslator } from "@/lib/i18n/translator";
import { webCardFor } from "@/mocks/fixtures";
import { WebCardView } from "./web-card-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const QR = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
const FETCHED = new Date("2026-10-08T09:30:00Z");

function show(card: WebCard, options: { locale?: "en" | "am"; supportUrl?: string } = {}) {
  const locale = options.locale ?? "en";
  const messages = locale === "en" ? en : am;
  const t = createTranslator({ messages, fallback: en });
  render(
    <I18nProvider locale={locale} messages={messages}>
      <ToastProvider>
        <WebCardView
          card={card}
          qr={QR}
          cardId="card-1"
          locale={locale}
          t={t}
          format={createFormatter(locale)}
          fetchedAt={FETCHED}
          supportUrl={options.supportUrl}
        />
      </ToastProvider>
    </I18nProvider>,
  );
}

const base = (stamps: number, rewards: number, status: WebCard["status"] = "ACTIVE") =>
  webCardFor("mock-token-1", { stamps, rewardsAvailable: rewards, status });

describe("WebCardView, active card", () => {
  it("shows branding, the customer's first name, progress, reward, terms and update time", () => {
    show(base(3, 0));
    expect(screen.getByRole("heading", { level: 1, name: "Sample Cafe" })).toBeInTheDocument();
    expect(screen.getByText("Coffee Card")).toBeInTheDocument();
    expect(screen.getByText("Hello, Abebe")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "3 of 8 stamps" })).toBeInTheDocument();
    expect(screen.getByText(/Reward at 8 stamps: Free coffee/)).toBeInTheDocument();
    expect(screen.getByText("Program terms")).toBeInTheDocument();
    expect(screen.getByText(/One stamp per visit/)).toBeInTheDocument();
    expect(screen.getByTestId("card-updated")).toHaveTextContent(/Last updated .*2026.*12:30/);
    expect(screen.queryByTestId("card-reward-ready")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-inactive")).not.toBeInTheDocument();
  });

  it("renders the QR code the backend value produced, and shows no card number as text", () => {
    show(base(3, 0));
    const qr = screen.getByTestId("card-qr");
    expect(qr).toHaveAttribute("role", "img");
    expect(qr.querySelector("svg")).not.toBeNull();
    expect(document.body.textContent).not.toContain("mock-token-1");
    expect(screen.getByText(/Do not share a screenshot/)).toBeInTheDocument();
  });

  it("makes an available reward unmistakable", () => {
    show(base(8, 1));
    const banner = screen.getByTestId("card-reward-ready");
    expect(within(banner).getByText("A reward is waiting for you")).toBeInTheDocument();
    expect(within(banner).getByText(/Free coffee/)).toBeInTheDocument();
    expect(screen.getByText("Reward ready")).toBeInTheDocument();
  });

  it("counts several waiting rewards", () => {
    show(base(16, 2));
    expect(screen.getByText("2 rewards ready")).toBeInTheDocument();
  });

  it("after a reward is redeemed, shows the completed card and no reward banner", () => {
    show(base(8, 0));
    expect(screen.queryByTestId("card-reward-ready")).not.toBeInTheDocument();
    expect(screen.getByTestId("card-completed")).toHaveTextContent(
      "You have completed this card once.",
    );
    expect(screen.getByRole("img", { name: "0 of 8 stamps" })).toBeInTheDocument();
  });

  it("says plainly that it is a loyalty card and never shows prices or payments", () => {
    show(base(3, 0));
    expect(screen.getByText(/not a payment card/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(
      /\bETB\b|\bBirr\b|\$|price|amount paid|payment method/i,
    );
  });

  it("links to the wallet screen and offers refresh, stop-marketing and remove", () => {
    show(base(3, 0));
    expect(screen.getByRole("link", { name: "Add to your phone wallet" })).toHaveAttribute(
      "href",
      "/en/card/wallet?c=card-1",
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop marketing messages" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove this card from this phone" }),
    ).toBeInTheDocument();
  });

  it("offers the support link when one is configured, and always the staff", () => {
    show(base(3, 0), { supportUrl: "https://help.example.org" });
    expect(screen.getByText("Ask the staff at Sample Cafe.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute(
      "href",
      "https://help.example.org",
    );
  });

  it("omits the support link when none is configured", () => {
    show(base(3, 0));
    expect(screen.queryByRole("link", { name: "Contact support" })).not.toBeInTheDocument();
    expect(screen.getByText("Ask the staff at Sample Cafe.")).toBeInTheDocument();
  });

  it("shows the business's own Amharic text on the Amharic page and the Amharic chrome", () => {
    show(base(3, 0), { locale: "am" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ናሙና ቡና ቤት");
    expect(screen.getByText("ሰላም Abebe")).toBeInTheDocument();
    expect(screen.getByText(/በአንድ ጉብኝት አንድ ስታምፕ/)).toBeInTheDocument();
  });

  it("falls back to the English original, marked as English, when the business wrote no Amharic", () => {
    const card = base(3, 0);
    card.merchant.nameAm = null;
    show(card, { locale: "am" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("lang", "en");
  });
});

describe("WebCardView, inactive memberships", () => {
  it.each([
    ["SUSPENDED", "This card is paused"],
    ["INVALIDATED", "This card is no longer valid"],
    ["PENDING", "Your card is being prepared"],
  ] as const)("%s says so and shows no QR code", (status, title) => {
    show(base(3, 0, status));
    expect(within(screen.getByTestId("card-inactive")).getByText(title)).toBeInTheDocument();
    expect(screen.queryByTestId("card-qr")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Add to your phone wallet" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-reward-ready")).not.toBeInTheDocument();
  });

  it("keeps a paused customer's stamps visible: they are safe", () => {
    show(base(3, 0, "SUSPENDED"));
    expect(screen.getByRole("img", { name: "3 of 8 stamps" })).toBeInTheDocument();
    expect(screen.getByText(/Your stamps are safe/)).toBeInTheDocument();
  });

  it("does not announce a reward on an inactive card", () => {
    show(base(8, 1, "SUSPENDED"));
    expect(screen.queryByTestId("card-reward-ready")).not.toBeInTheDocument();
  });
});
