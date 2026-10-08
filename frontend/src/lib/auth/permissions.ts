import type { MessageKey } from "@/lib/i18n/translator";
import type { AccountKind } from "./session-data";

/**
 * Who may see which part of the app. This mirrors the backend's permission catalogue
 * (backend/prisma/reference-data.ts) and is used to decide navigation and to guard routes. It is a
 * convenience for the UI: the BACKEND enforces every permission again on every request, so hiding a link
 * or blocking a page here is never the only protection.
 */
export type Area = "staff" | "merchant" | "operations";

export interface RouteRule {
  /** Path without the language prefix. A rule covers the path and everything below it. */
  path: string;
  area: Area;
  permission: string;
}

export const AREA_ACCOUNT_KIND: Record<Area, AccountKind> = {
  staff: "merchant",
  merchant: "merchant",
  operations: "platform",
};

/**
 * Each area also has an ENTRY permission that every page inside it requires on top of its own. Without it, branch
 * staff (who hold program:read, branch:read and customer:read for the scanner) would qualify for dashboard pages.
 */
export const AREA_ENTRY_PERMISSION: Record<Area, string> = {
  staff: "stamp:create",
  merchant: "merchant:read",
  operations: "platform:manage",
};

export const ROUTE_RULES: readonly RouteRule[] = [
  { path: "/staff/scanner", area: "staff", permission: "stamp:create" },
  { path: "/staff/branch", area: "staff", permission: "stamp:create" },

  { path: "/dashboard/program", area: "merchant", permission: "program:read" },
  { path: "/dashboard/branches", area: "merchant", permission: "branch:read" },
  { path: "/dashboard/team", area: "merchant", permission: "staff:read" },
  { path: "/dashboard/customers", area: "merchant", permission: "customer:read" },
  { path: "/dashboard/rewards", area: "merchant", permission: "customer:read" },
  { path: "/dashboard/campaigns", area: "merchant", permission: "customer:manage" },
  { path: "/dashboard/analytics", area: "merchant", permission: "analytics:read" },
  { path: "/dashboard/audit", area: "merchant", permission: "audit:read" },
  { path: "/dashboard/settings", area: "merchant", permission: "merchant:update" },
  { path: "/dashboard", area: "merchant", permission: "merchant:read" },

  { path: "/operations/merchants", area: "operations", permission: "platform:manage" },
  { path: "/operations/fraud", area: "operations", permission: "platform:manage" },
  { path: "/operations/wallet-health", area: "operations", permission: "platform:manage" },
  { path: "/operations/privacy", area: "operations", permission: "platform:manage" },
  { path: "/operations/audit", area: "operations", permission: "platform:audit:read" },
  { path: "/operations/system", area: "operations", permission: "platform:manage" },
  { path: "/operations", area: "operations", permission: "platform:manage" },
];

/** The most specific rule covering a language-less path, or undefined for public paths. */
export function ruleFor(path: string): RouteRule | undefined {
  const clean = path.replace(/\/+$/, "") || "/";
  return [...ROUTE_RULES]
    .sort((a, b) => b.path.length - a.path.length)
    .find((rule) => clean === rule.path || clean.startsWith(`${rule.path}/`));
}

export interface Principal {
  kind: AccountKind;
  permissions: readonly string[];
}

/**
 * True when the principal may open the path. Unknown protected-looking paths are denied (fail closed);
 * paths that no rule covers and that are not in a protected area are public.
 */
export function canAccess(path: string, principal: Principal): boolean {
  const rule = ruleFor(path);
  if (!rule) return !isProtectedPath(path);
  if (AREA_ACCOUNT_KIND[rule.area] !== principal.kind) return false;
  return (
    principal.permissions.includes(AREA_ENTRY_PERMISSION[rule.area]) &&
    principal.permissions.includes(rule.permission)
  );
}

export const PROTECTED_PREFIXES = ["/staff", "/dashboard", "/operations"] as const;

export function isProtectedPath(path: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function areaOf(path: string): Area | undefined {
  if (path === "/staff" || path.startsWith("/staff/")) return "staff";
  if (path === "/dashboard" || path.startsWith("/dashboard/")) return "merchant";
  if (path === "/operations" || path.startsWith("/operations/")) return "operations";
  return undefined;
}

export interface NavItem {
  id: string;
  href: string;
  labelKey: MessageKey;
}

const NAV: Record<Area, NavItem[]> = {
  staff: [
    { id: "scanner", href: "/staff/scanner", labelKey: "nav.scanner" },
    { id: "branch", href: "/staff/branch", labelKey: "nav.branch" },
  ],
  merchant: [
    { id: "overview", href: "/dashboard", labelKey: "nav.overview" },
    { id: "program", href: "/dashboard/program", labelKey: "nav.program" },
    { id: "branches", href: "/dashboard/branches", labelKey: "nav.branches" },
    { id: "team", href: "/dashboard/team", labelKey: "nav.team" },
    { id: "customers", href: "/dashboard/customers", labelKey: "nav.customers" },
    { id: "rewards", href: "/dashboard/rewards", labelKey: "nav.rewards" },
    { id: "campaigns", href: "/dashboard/campaigns", labelKey: "nav.campaigns" },
    { id: "analytics", href: "/dashboard/analytics", labelKey: "nav.analytics" },
    { id: "audit", href: "/dashboard/audit", labelKey: "nav.audit" },
    { id: "settings", href: "/dashboard/settings", labelKey: "nav.settings" },
  ],
  operations: [
    { id: "overview", href: "/operations", labelKey: "nav.overview" },
    { id: "merchants", href: "/operations/merchants", labelKey: "nav.merchants" },
    { id: "fraud", href: "/operations/fraud", labelKey: "nav.fraud" },
    { id: "wallet-health", href: "/operations/wallet-health", labelKey: "nav.walletHealth" },
    { id: "privacy", href: "/operations/privacy", labelKey: "nav.privacy" },
    { id: "audit", href: "/operations/audit", labelKey: "nav.audit" },
    { id: "system", href: "/operations/system", labelKey: "nav.system" },
  ],
};

/** Navigation entries the principal may open: exactly the routes `canAccess` allows, in a fixed order. */
export function visibleNav(area: Area, principal: Principal): NavItem[] {
  return NAV[area].filter((item) => canAccess(item.href, principal));
}

/** Where a freshly signed-in person lands. Role names are not trusted for access, only for convenience. */
export function homeFor(principal: Principal): string {
  if (principal.kind === "platform") return "/operations";
  const merchant = canAccess("/dashboard", principal);
  const scanner = canAccess("/staff/scanner", principal);
  if (merchant) return "/dashboard";
  if (scanner) return "/staff/scanner";
  return "/denied";
}
