import { describe, expect, it } from "vitest";
import { monogram, pickLocalized, readableOn, safeBrandColor } from "./localized";

describe("pickLocalized", () => {
  it("uses the business's own Amharic text on the Amharic page", () => {
    expect(pickLocalized("am", "Free coffee", "ነጻ ቡና")).toEqual({ text: "ነጻ ቡና", lang: "am" });
  });
  it("shows the English original, marked as English, when no Amharic was written", () => {
    expect(pickLocalized("am", "Free coffee", null)).toEqual({ text: "Free coffee", lang: "en" });
    expect(pickLocalized("am", "Free coffee", "  ")).toEqual({ text: "Free coffee", lang: "en" });
  });
  it("never swaps the English page for Amharic", () => {
    expect(pickLocalized("en", "Free coffee", "ነጻ ቡና")).toEqual({
      text: "Free coffee",
      lang: "en",
    });
  });
});

describe("brand colour", () => {
  it("only lets plain hex colours into a style", () => {
    expect(safeBrandColor("#1B5E3A")).toBe("#1B5E3A");
    for (const bad of [
      "red",
      "#fff",
      "url(javascript:1)",
      "#1B5E3A; background:red",
      "",
      null,
      undefined,
    ]) {
      expect(safeBrandColor(bad)).toBe("#1b5e3a");
    }
  });
  it("picks readable text", () => {
    expect(readableOn("#ffffff")).toBe("#1a1a1a");
    expect(readableOn("#1b5e3a")).toBe("#ffffff");
    expect(readableOn("#ffd700")).toBe("#1a1a1a");
  });
});

describe("monogram", () => {
  it("takes the first letter, including Ethiopic ones", () => {
    expect(monogram("Sample Cafe")).toBe("S");
    expect(monogram("  ናሙና ቡና ቤት")).toBe("ና");
    expect(monogram("")).toBe("•");
  });
});
