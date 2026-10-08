import { describe, expect, it } from "vitest";
import { isJoinReference, joinUrl } from "./qr-links";

describe("joinUrl", () => {
  const origin = "https://card.example.org";

  it("points each poster language at its own page", () => {
    expect(joinUrl(origin, "sample-cafe", "en")).toBe(
      "https://card.example.org/en/join/sample-cafe",
    );
    expect(joinUrl(origin, "sample-cafe", "am")).toBe(
      "https://card.example.org/am/join/sample-cafe",
    );
  });

  it("leaves the language out for the bilingual poster, so each visitor gets their own", () => {
    expect(joinUrl(origin, "sample-cafe", "both")).toBe(
      "https://card.example.org/join/sample-cafe",
    );
  });

  it("ignores a trailing slash on the origin", () => {
    expect(joinUrl("https://card.example.org/", "x1", "en")).toBe(
      "https://card.example.org/en/join/x1",
    );
  });

  it("only ever contains the public reference, never an internal identifier", () => {
    const url = joinUrl(origin, "sample-cafe", "both");
    expect(url).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(url).not.toMatch(/merchant|program|branch|staff/i);
  });
});

describe("isJoinReference", () => {
  it("accepts the shape of a public reference", () => {
    expect(isJoinReference("sample-cafe")).toBe(true);
    expect(isJoinReference("A1.b_2~c-3")).toBe(true);
  });

  it.each(["", "../x", "a b", "a/b", "-start", "x".repeat(200), "<script>", null, undefined])(
    "refuses %j",
    (value) => {
      expect(isJoinReference(value as string)).toBe(false);
    },
  );
});
