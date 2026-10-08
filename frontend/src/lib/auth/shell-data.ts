import "server-only";
import type { NavLink } from "@/components/layout/area-nav";
import type { Locale } from "@/lib/i18n/config";
import { getTranslator } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translator";
import { visibleNav, type Area } from "./permissions";
import { loadBranches, loadBusinessName, requireArea } from "./server";
import type { SessionView } from "./session-context";

export interface ShellData {
  session: SessionView;
  roleLabel: string;
  navLabel: string;
  nav: NavLink[];
  /** "Sample Cafe", "Bole": where the person is working. */
  context: string[];
  /** Branch staff with more than one branch can switch. */
  switchBranchHref?: string;
}

const ROLE_KEYS: Record<string, MessageKey> = {
  OWNER: "auth.roleOwner",
  MANAGER: "auth.roleManager",
  STAFF: "auth.roleStaff",
  PLATFORM_ADMIN: "auth.rolePlatformAdmin",
};

const localized = (locale: Locale, en: string, am: string | null) =>
  locale === "am" && am ? am : en;

/**
 * Everything an authenticated shell shows, decided on the server for one request: who is signed in, which
 * navigation entries they may open (exactly the routes `canAccess` allows), and their business and branch.
 * Performs the layout-level access check, so a wrong kind of account never gets a shell at all.
 */
export async function loadShellData(locale: Locale, area: Area): Promise<ShellData> {
  const ctx = await requireArea(locale, area);
  const t = await getTranslator(locale);

  const nav = visibleNav(area, ctx.principal).map((item) => ({
    id: item.id,
    href: `/${locale}${item.href}`,
    label: t(item.labelKey),
  }));

  const context: string[] = [];
  let switchBranchHref: string | undefined;
  if (area === "merchant") {
    const business = await loadBusinessName();
    if (business) context.push(localized(locale, business.nameEn, business.nameAm));
  }
  if (area === "staff") {
    const { branches, current } = await loadBranches();
    if (current) context.push(localized(locale, current.nameEn, current.nameAm));
    if (branches.filter((b) => b.status === "ACTIVE").length > 1) {
      switchBranchHref = `/${locale}/staff/branch`;
    }
  }

  const roleKey = ROLE_KEYS[ctx.me.role];
  return {
    session: {
      displayName: ctx.session.user.displayName,
      role: ctx.me.role,
      kind: ctx.me.kind,
      permissions: ctx.me.permissions,
    },
    roleLabel: roleKey ? t(roleKey) : ctx.me.role,
    navLabel: t("nav.menu"),
    nav,
    context,
    switchBranchHref,
  };
}
