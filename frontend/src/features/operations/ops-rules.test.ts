import { describe, expect, it } from "vitest";
import type { PlatformMerchant } from "@/lib/api/contract";
import { filterMerchants, redactError } from "./ops-rules";

describe("redactError", () => {
  it("hides secret-looking values, bearer tokens, JWTs and long opaque strings", () => {
    const text = redactError(
      "push failed token=BAIT-TOKEN password: BAIT-PASSWORD Authorization: Bearer abc.def.ghi " +
        'api_key="BAIT-KEY" eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk ' +
        "id=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCD",
    );
    for (const secret of [
      "BAIT-TOKEN",
      "BAIT-PASSWORD",
      "abc.def.ghi",
      "BAIT-KEY",
      "eyJhbGci",
      "AbCdEfGhIjKlMnOp",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain("push failed");
    expect(text).toContain("[hidden]");
  });

  it("keeps ordinary diagnostic words", () => {
    expect(redactError("Timeout after 5 attempts contacting the provider.")).toBe(
      "Timeout after 5 attempts contacting the provider.",
    );
  });

  it("shortens long text, removes control characters, and copes with nothing", () => {
    const long = redactError("word ".repeat(200));
    expect(long.length).toBeLessThanOrEqual(281);
    expect(long.endsWith("…")).toBe(true);
    expect(redactError("a\u0000b\nc")).toBe("a b c");
    expect(redactError(null)).toBe("");
    expect(redactError(undefined)).toBe("");
  });
});

const merchants: PlatformMerchant[] = [
  { id: "1", slug: "sample-cafe", nameEn: "Sample Cafe", nameAm: "ናሙና ካፌ", status: "ACTIVE" },
  { id: "2", slug: "bole-bakery", nameEn: "Bole Bakery", nameAm: null, status: "SUSPENDED" },
  { id: "3", slug: "old-tea", nameEn: "Old Tea House", nameAm: null, status: "DEACTIVATED" },
];

describe("filterMerchants", () => {
  it("searches name in either language and the short name, ignoring case", () => {
    const find = (search: string, status = "") =>
      filterMerchants(merchants, { search, status }).map((m) => m.id);
    expect(find("sample")).toEqual(["1"]);
    expect(find("ናሙና")).toEqual(["1"]);
    expect(find("BAKERY")).toEqual(["2"]);
    expect(find("old-tea")).toEqual(["3"]);
    expect(find("nothing")).toEqual([]);
    expect(find("")).toEqual(["1", "2", "3"]);
  });

  it("filters by status and combines it with the search", () => {
    expect(
      filterMerchants(merchants, { search: "", status: "SUSPENDED" }).map((m) => m.id),
    ).toEqual(["2"]);
    expect(filterMerchants(merchants, { search: "cafe", status: "SUSPENDED" })).toEqual([]);
  });
});
