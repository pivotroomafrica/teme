import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";
import { ErrorView, LoadingView, NotFoundView } from "./state-views";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const wrap = (locale: "en" | "am", ui: ReactNode) =>
  render(
    <I18nProvider locale={locale} messages={locale === "en" ? en : am}>
      {ui}
    </I18nProvider>,
  );

describe("state views", () => {
  it("announces errors, shows the reference and lets the user retry", async () => {
    const retry = vi.fn();
    wrap("en", <ErrorView reference="abc123" onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByText("abc123")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("never shows raw error details", () => {
    wrap("en", <ErrorView />);
    expect(screen.queryByText(/stack|exception|prisma/i)).toBeNull();
  });

  it("links home in the active language", () => {
    wrap("am", <NotFoundView />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(am.errors.notFoundTitle);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/am");
  });

  it("exposes loading as a polite status", () => {
    wrap("en", <LoadingView />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });
});
