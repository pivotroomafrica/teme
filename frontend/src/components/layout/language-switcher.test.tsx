import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/messages/en";
import { LanguageSwitcher } from "./language-switcher";

vi.mock("next/navigation", () => ({ usePathname: () => "/am/dashboard/team" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("LanguageSwitcher", () => {
  it("links to the same page in each language and marks the current one", () => {
    render(
      <I18nProvider locale="am" messages={en}>
        <LanguageSwitcher current="am" />
      </I18nProvider>,
    );
    expect(screen.getByRole("navigation", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "English" })).toHaveAttribute(
      "href",
      "/en/dashboard/team",
    );
    const amharic = screen.getByRole("link", { name: "አማርኛ" });
    expect(amharic).toHaveAttribute("href", "/am/dashboard/team");
    expect(amharic).toHaveAttribute("aria-current", "true");
    expect(amharic).toHaveAttribute("lang", "am");
  });
});
