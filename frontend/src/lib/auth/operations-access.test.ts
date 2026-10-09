import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { MOCK_ACCOUNTS } from "@/mocks/fixtures";
import { resolveBffRoute } from "./bff-routes";
import { canAccess, ruleFor, visibleNav, type Principal } from "./permissions";

const principal = (email: keyof typeof MOCK_ACCOUNTS): Principal => ({
  kind: MOCK_ACCOUNTS[email].kind,
  permissions: MOCK_ACCOUNTS[email].permissions,
});

const OPERATIONS_PATHS = [
  "/operations",
  "/operations/merchants",
  "/operations/merchants/00000000-0000-4000-8000-0000000a0001",
  "/operations/fraud",
  "/operations/wallet-health",
  "/operations/privacy",
  "/operations/audit",
  "/operations/system",
  "/operations/anything-new",
];

describe("operations access", () => {
  it("is closed to every merchant-side account on every operations path, including nested and unknown ones", () => {
    for (const email of [
      "owner@mock.test",
      "manager@mock.test",
      "staff@mock.test",
      "viewer@mock.test",
    ] as const) {
      for (const path of OPERATIONS_PATHS)
        expect(canAccess(path, principal(email)), `${email} ${path}`).toBe(false);
      expect(visibleNav("operations", principal(email)), email).toEqual([]);
    }
  });

  it("is open to the platform administrator, and the audit needs its own explicit permission", () => {
    for (const path of OPERATIONS_PATHS)
      expect(canAccess(path, principal("admin@mock.test")), path).toBe(true);
    const manageOnly: Principal = { kind: "platform", permissions: ["platform:manage"] };
    expect(canAccess("/operations/audit", manageOnly)).toBe(false);
    expect(canAccess("/operations/merchants/abc12345", manageOnly)).toBe(true);
    const auditOnly: Principal = { kind: "platform", permissions: ["platform:audit:read"] };
    for (const path of OPERATIONS_PATHS) expect(canAccess(path, auditOnly), path).toBe(false);
  });

  it("requires the platform entry permission even with a platform account and no permissions", () => {
    const empty: Principal = { kind: "platform", permissions: [] };
    for (const path of OPERATIONS_PATHS) expect(canAccess(path, empty), path).toBe(false);
  });

  it("covers a merchant detail page with the merchants rule", () => {
    expect(ruleFor("/operations/merchants/abc")?.path).toBe("/operations/merchants");
    expect(ruleFor("/operations/audit/x")?.permission).toBe("platform:audit:read");
  });

  it("never lists an operations link in the merchant or staff navigation", () => {
    for (const email of ["owner@mock.test", "manager@mock.test", "staff@mock.test"] as const) {
      const links = [
        ...visibleNav("merchant", principal(email)),
        ...visibleNav("staff", principal(email)),
      ];
      expect(
        links.some((l) => l.href.startsWith("/operations")),
        email,
      ).toBe(false);
    }
  });

  it("shows the administrator operations navigation only, with the audit entry only when permitted", () => {
    const ids = (p: Principal) => visibleNav("operations", p).map((i) => i.id);
    expect(ids(principal("admin@mock.test"))).toEqual([
      "overview",
      "merchants",
      "fraud",
      "wallet-health",
      "privacy",
      "audit",
      "system",
    ]);
    expect(ids({ kind: "platform", permissions: ["platform:manage"] })).not.toContain("audit");
    expect(visibleNav("merchant", principal("admin@mock.test"))).toEqual([]);
    expect(visibleNav("staff", principal("admin@mock.test"))).toEqual([]);
  });

  it("only forwards platform routes to signed-in sessions through the browser proxy, and nothing outside it", () => {
    expect(resolveBffRoute("GET", ["platform", "merchants"])?.access).toBe("private");
    expect(
      resolveBffRoute("POST", ["platform", "outbox", "dead", "abc12345", "requeue"])?.access,
    ).toBe("private");
    // Health is read on the server only; the proxy does not expose it.
    expect(resolveBffRoute("GET", ["health", "ready"])).toBeNull();
    expect(resolveBffRoute("GET", ["platform", "..", "auth"])).toBeNull();
    expect(resolveBffRoute("POST", ["auth", "login"])).toBeNull();
  });
});

describe("every operations page checks access before it renders anything", () => {
  const root = join(process.cwd(), "src", "app", "[locale]", "(operations)", "operations");
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "page.tsx") pages.push(full);
    }
  };
  walk(root);

  it("finds the pages", () => {
    expect(pages.length).toBeGreaterThanOrEqual(8);
  });

  it("uses the shared frame (which runs requireRoute) with the page's own route", () => {
    for (const file of pages) {
      const source = readFileSync(file, "utf8");
      const rel = relative(root, file)
        .replace(/page\.tsx$/, "")
        .split(sep)
        .filter(Boolean)
        .join("/");
      const route = rel ? `/operations/${rel}` : "/operations";
      const expected = route.replace(/\[(\w+)\]/g, "${$1}");
      expect(source, file).toContain("<OpsFrame");
      expect(source, file).toMatch(
        expected.includes("${")
          ? new RegExp("path=\\{`" + expected.replace(/[/$.{}]/g, "\\$&") + "`\\}")
          : new RegExp(`path="${expected}"`),
      );
    }
  });

  it("has a frame that checks the route first", () => {
    const frame = readFileSync(
      join(process.cwd(), "src", "features", "operations", "page-frame.tsx"),
      "utf8",
    );
    expect(frame.indexOf("requireRoute(")).toBeGreaterThan(-1);
    expect(frame.indexOf("requireRoute(")).toBeLessThan(frame.indexOf("getMessages("));
  });
});
