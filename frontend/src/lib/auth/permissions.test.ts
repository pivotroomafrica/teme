import { describe, expect, it } from "vitest";
import { MOCK_ACCOUNTS, type MockEmail } from "@/mocks/fixtures";
import {
  ROUTE_RULES,
  areaOf,
  canAccess,
  homeFor,
  isProtectedPath,
  ruleFor,
  visibleNav,
  type Principal,
} from "./permissions";

const principal = (email: MockEmail): Principal => ({
  kind: MOCK_ACCOUNTS[email].kind,
  permissions: MOCK_ACCOUNTS[email].permissions,
});
const owner = principal("owner@mock.test");
const manager = principal("manager@mock.test");
const staff = principal("staff@mock.test");
const admin = principal("admin@mock.test");

const MERCHANT_PATHS = [
  "/dashboard",
  "/dashboard/program",
  "/dashboard/branches",
  "/dashboard/team",
  "/dashboard/customers",
  "/dashboard/rewards",
  "/dashboard/campaigns",
  "/dashboard/analytics",
  "/dashboard/audit",
  "/dashboard/settings",
];
const OPERATIONS_PATHS = [
  "/operations",
  "/operations/merchants",
  "/operations/fraud",
  "/operations/wallet-health",
  "/operations/privacy",
  "/operations/audit",
  "/operations/system",
];
const STAFF_PATHS = ["/staff/scanner", "/staff/branch"];

describe("route access by role", () => {
  it("lets a merchant owner open the dashboard and the scanner, never operations", () => {
    for (const path of [...MERCHANT_PATHS, ...STAFF_PATHS])
      expect(canAccess(path, owner), path).toBe(true);
    for (const path of OPERATIONS_PATHS) expect(canAccess(path, owner), path).toBe(false);
  });

  it("lets a manager do the same (their permissions are the owner's minus privacy and fraud management)", () => {
    for (const path of [...MERCHANT_PATHS, ...STAFF_PATHS])
      expect(canAccess(path, manager), path).toBe(true);
    for (const path of OPERATIONS_PATHS) expect(canAccess(path, manager), path).toBe(false);
  });

  it("keeps branch staff in the scanner: no dashboard page at all", () => {
    for (const path of STAFF_PATHS) expect(canAccess(path, staff), path).toBe(true);
    for (const path of [...MERCHANT_PATHS, ...OPERATIONS_PATHS])
      expect(canAccess(path, staff), path).toBe(false);
  });

  it("keeps platform administrators in operations: no merchant data, no scanner", () => {
    for (const path of OPERATIONS_PATHS) expect(canAccess(path, admin), path).toBe(true);
    for (const path of [...MERCHANT_PATHS, ...STAFF_PATHS])
      expect(canAccess(path, admin), path).toBe(false);
  });

  it("applies the permission of the most specific rule, including nested paths", () => {
    expect(ruleFor("/dashboard/analytics/cohorts")?.permission).toBe("analytics:read");
    expect(ruleFor("/dashboard/analytics/")?.path).toBe("/dashboard/analytics");
    expect(ruleFor("/dashboard/unknown-page")?.path).toBe("/dashboard");
    const noAnalytics: Principal = { kind: "merchant", permissions: ["merchant:read"] };
    expect(canAccess("/dashboard", noAnalytics)).toBe(true);
    expect(canAccess("/dashboard/analytics", noAnalytics)).toBe(false);
    expect(canAccess("/dashboard/analytics/anything/deeper", noAnalytics)).toBe(false);
  });

  it("requires platform:audit:read for the platform audit page specifically", () => {
    const limited: Principal = { kind: "platform", permissions: ["platform:manage"] };
    expect(canAccess("/operations/audit", limited)).toBe(false);
    expect(canAccess("/operations/system", limited)).toBe(true);
  });

  it("does not let a merchant account with a platform permission string into operations (kind is checked)", () => {
    const forged: Principal = { kind: "merchant", permissions: ["platform:manage"] };
    expect(canAccess("/operations", forged)).toBe(false);
    const forgedPlatform: Principal = {
      kind: "platform",
      permissions: ["merchant:read", "stamp:create"],
    };
    expect(canAccess("/dashboard", forgedPlatform)).toBe(false);
    expect(canAccess("/staff/scanner", forgedPlatform)).toBe(false);
  });

  it("fails closed for protected-looking paths and leaves public paths open", () => {
    expect(canAccess("/staff", staff)).toBe(false); // no rule for the bare prefix
    expect(isProtectedPath("/dashboard/whatever")).toBe(true);
    for (const path of ["/", "/login", "/join/sample-cafe", "/card", "/denied"]) {
      expect(canAccess(path, { kind: "merchant", permissions: [] }), path).toBe(true);
    }
  });

  it("knows which area a path belongs to", () => {
    expect(areaOf("/staff/scanner")).toBe("staff");
    expect(areaOf("/dashboard/team")).toBe("merchant");
    expect(areaOf("/operations")).toBe("operations");
    expect(areaOf("/join/x")).toBeUndefined();
  });

  it("has a rule for every navigable route", () => {
    for (const area of ["staff", "merchant", "operations"] as const) {
      for (const item of visibleNav(area, {
        kind: area === "operations" ? "platform" : "merchant",
        permissions: [
          ...MOCK_ACCOUNTS["owner@mock.test"].permissions,
          ...MOCK_ACCOUNTS["admin@mock.test"].permissions,
        ],
      })) {
        expect(ruleFor(item.href), item.href).toBeDefined();
      }
    }
    expect(ROUTE_RULES.length).toBeGreaterThan(15);
  });
});

describe("navigation by role", () => {
  const ids = (area: Parameters<typeof visibleNav>[0], p: Principal) =>
    visibleNav(area, p).map((i) => i.id);

  it("shows owners and managers the whole dashboard", () => {
    expect(ids("merchant", owner)).toEqual([
      "overview",
      "program",
      "branches",
      "team",
      "customers",
      "rewards",
      "campaigns",
      "analytics",
      "audit",
      "settings",
    ]);
    expect(ids("merchant", manager)).toEqual(ids("merchant", owner));
  });

  it("shows branch staff nothing of the dashboard and the scanner entries only", () => {
    expect(ids("merchant", staff)).toEqual([]);
    expect(ids("staff", staff)).toEqual(["scanner", "branch"]);
    expect(ids("operations", staff)).toEqual([]);
  });

  it("shows platform administrators operations only", () => {
    expect(ids("operations", admin)).toEqual([
      "overview",
      "merchants",
      "fraud",
      "wallet-health",
      "privacy",
      "audit",
      "system",
    ]);
    expect(ids("merchant", admin)).toEqual([]);
    expect(ids("staff", admin)).toEqual([]);
  });

  it("hides entries the person's permissions do not cover", () => {
    const readOnly: Principal = {
      kind: "merchant",
      permissions: ["merchant:read", "customer:read"],
    };
    expect(ids("merchant", readOnly)).toEqual(["overview", "customers", "rewards"]);
  });

  it("every visible link is also an allowed route (navigation can never offer a forbidden page)", () => {
    for (const p of [owner, manager, staff, admin]) {
      for (const area of ["staff", "merchant", "operations"] as const) {
        for (const item of visibleNav(area, p)) expect(canAccess(item.href, p)).toBe(true);
      }
    }
  });
});

describe("home page after sign-in", () => {
  it("sends each role to the right place", () => {
    expect(homeFor(owner)).toBe("/dashboard");
    expect(homeFor(manager)).toBe("/dashboard");
    expect(homeFor(staff)).toBe("/staff/scanner");
    expect(homeFor(admin)).toBe("/operations");
  });

  it("sends an account with no usable permissions to the access page", () => {
    expect(homeFor({ kind: "merchant", permissions: [] })).toBe("/denied");
  });
});
