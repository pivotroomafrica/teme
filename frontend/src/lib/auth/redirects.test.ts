import { describe, expect, it } from "vitest";
import type { Principal } from "./permissions";
import { safeNextPath } from "./redirects";

const owner: Principal = {
  kind: "merchant",
  permissions: ["merchant:read", "analytics:read", "customer:read", "stamp:create"],
};
const safe = (next: string | null | undefined, principal?: Principal, locale: "en" | "am" = "en") =>
  safeNextPath(next, { locale, principal });

describe("safeNextPath", () => {
  it("returns a local path with the language prefix", () => {
    expect(safe("/dashboard/analytics")).toBe("/en/dashboard/analytics");
    expect(safe("/dashboard/customers?q=abebe&limit=10")).toBe(
      "/en/dashboard/customers?q=abebe&limit=10",
    );
    expect(safe("/staff/scanner", undefined, "am")).toBe("/am/staff/scanner");
  });

  it("keeps a language prefix that is already there", () => {
    expect(safe("/am/dashboard")).toBe("/am/dashboard");
    expect(safe("/en/dashboard", undefined, "am")).toBe("/en/dashboard");
  });

  it("drops the fragment", () => {
    expect(safe("/dashboard#section")).toBe("/en/dashboard");
  });

  describe("rejects every open-redirect trick", () => {
    const attacks = [
      "https://evil.example/phish",
      "http://evil.example",
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "\\/evil.example",
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "mailto:a@b.c",
      "evil.example/path",
      "dashboard",
      "/%2F%2Fevil.example",
      "/%2f%2fevil.example",
      "/%252F%252Fevil.example",
      "/%5Cevil.example",
      "/dashboard/../../etc/passwd",
      "/dashboard/%2e%2e/%2e%2e/secret",
      "/dashboard\r\nSet-Cookie: x=1",
      "/dashboard%0d%0aLocation: https://evil.example",
      "/dashboard\u0000.png",
      "/\t/evil.example",
      "/%09/evil.example",
      "/ /evil.example",
      "",
      " /dashboard",
      "/" + "a".repeat(2000),
    ];
    it.each(attacks)("%j", (attack) => {
      expect(safe(attack)).toBeNull();
    });

    it("rejects non-strings", () => {
      expect(safe(undefined)).toBeNull();
      expect(safe(null)).toBeNull();
      expect(safeNextPath(123 as unknown as string, { locale: "en" })).toBeNull();
      expect(
        safeNextPath({ toString: () => "/x" } as unknown as string, { locale: "en" }),
      ).toBeNull();
    });

    it("rejects malformed percent-encoding", () => {
      expect(safe("/dashboard/%E0%A4%A")).toBeNull();
    });
  });

  it("never sends people back to the sign-in and error pages (no loops)", () => {
    for (const next of [
      "/login",
      "/en/login",
      "/am/login?next=/x",
      "/session-expired",
      "/denied",
      "/login/",
    ]) {
      expect(safe(next), next).toBeNull();
    }
  });

  it("refuses a destination the person is not allowed to open", () => {
    expect(safe("/dashboard/analytics", owner)).toBe("/en/dashboard/analytics");
    expect(safe("/dashboard/audit", owner)).toBeNull();
    expect(safe("/operations", owner)).toBeNull();
    expect(safe("/staff/scanner", owner)).toBe("/en/staff/scanner");
  });

  it("allows public local pages for anyone", () => {
    expect(safe("/join/sample-cafe", owner)).toBe("/en/join/sample-cafe");
  });
});
