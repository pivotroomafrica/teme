import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translator";
import { en } from "@/lib/i18n/messages/en";
import { MOCK_JOIN_INFO } from "@/mocks/fixtures";
import { MerchantSummary } from "./merchant-summary";

/**
 * Everything a business writes (names, rewards, colours) is untrusted text. React escapes text, and these tests pin
 * down that nothing in the screens turns such text into markup, links, scripts or styles.
 */
const t = createTranslator({ messages: en, fallback: en });
const HOSTILE = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';

function renderWith(overrides: Record<string, unknown>) {
  const info = structuredClone(MOCK_JOIN_INFO) as typeof MOCK_JOIN_INFO;
  Object.assign(info.merchant, overrides.merchant ?? {});
  Object.assign(info.program, overrides.program ?? {});
  return render(<MerchantSummary info={info} locale="en" t={t} />);
}

describe("merchant-written text", () => {
  it("is shown as plain text, never as markup", () => {
    const { container } = renderWith({
      merchant: { nameEn: HOSTILE, nameAm: null },
      program: {
        nameEn: HOSTILE,
        nameAm: null,
        reward: { nameEn: HOSTILE, nameAm: null, descriptionEn: HOSTILE, descriptionAm: null },
      },
    });
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.textContent).toContain("<script>window.__pwned=1</script>");
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("cannot smuggle styles through the brand colour", () => {
    const { container } = renderWith({
      program: { brandColor: "red; background-image: url(javascript:alert(1))" },
    });
    const styled = container.querySelector("[style]") as HTMLElement;
    expect(styled.getAttribute("style")).not.toMatch(/url|javascript|;.*;.*;/);
    expect(styled.style.backgroundColor).not.toBe("");
  });

  it("keeps very long unbroken text inside its box", () => {
    const { container } = renderWith({ merchant: { nameEn: "W".repeat(300), nameAm: null } });
    expect(container.querySelector("h1")!.className).toContain("break-words");
  });
});
