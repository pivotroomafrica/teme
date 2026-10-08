import Link from "next/link";
import type { ReactNode } from "react";
import { AccountMenu } from "@/features/auth/components/account-menu";
import { SessionWatcher } from "@/features/auth/components/session-watcher";
import { SessionProvider } from "@/lib/auth/session-context";
import type { ShellData } from "@/lib/auth/shell-data";
import type { Locale } from "@/lib/i18n/config";
import { getTranslator } from "@/lib/i18n/server";
import { AreaNav } from "./area-nav";
import { LanguageSwitcher } from "./language-switcher";
import { Logo } from "./logo";

/**
 * Page shells, one per product surface, so route groups are visibly and structurally separate:
 *  - PublicShell      customers (join, card): minimal, light, single column
 *  - AuthShell        sign-in and session pages: centred card
 *  - StaffShell       phone-first scanner chrome
 *  - MerchantShell    business dashboard (sidebar on wide screens)
 *  - OperationsShell  TemelashCard staff console, deliberately different colours so it is never mistaken for a merchant view
 * The three signed-in shells receive ShellData from the server (who, where, which navigation): they render
 * what they are given and decide nothing about access.
 */

interface ShellProps {
  locale: Locale;
  children: ReactNode;
}

interface AuthedShellProps extends ShellProps {
  data: ShellData;
}

async function SkipLink({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale);
  return (
    <a
      href="#main"
      className="sr-only-focusable absolute top-2 left-2 z-50 rounded-lg bg-white px-4 py-3 text-green-800 shadow-lg"
    >
      {t("common.skipToContent")}
    </a>
  );
}

function Brand({ locale, light = false }: { locale: Locale; light?: boolean }) {
  return (
    <Link
      href={`/${locale}`}
      className={
        "touch-target inline-flex items-center gap-2 font-semibold no-underline " +
        (light ? "text-white" : "text-green-800")
      }
    >
      <Logo />
      <span>TemelashCard</span>
    </Link>
  );
}

export async function PublicShell({ locale, children }: ShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink locale={locale} />
      <div className="tc-border-pattern h-1.5" aria-hidden="true" />
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 py-3">
        <Brand locale={locale} />
        <LanguageSwitcher current={locale} />
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
        {children}
      </main>
    </div>
  );
}

export async function AuthShell({ locale, children }: ShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink locale={locale} />
      <header className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-4 py-4">
        <Brand locale={locale} />
        <LanguageSwitcher current={locale} />
      </header>
      <main
        id="main"
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pb-16"
      >
        <div className="rounded-card border border-border bg-surface p-6 shadow-sm">{children}</div>
      </main>
    </div>
  );
}

/** "Sample Cafe · Bole" and the role, so people always see where they are working and as whom. */
function WhoAndWhere({ data, light }: { data: ShellData; light?: boolean }) {
  const text = light ? "text-white/90" : "text-muted";
  return (
    <p className={`min-w-0 text-sm ${text}`} data-testid="shell-context">
      <span className="font-semibold">{data.roleLabel}</span>
      {data.context.map((part) => (
        <span key={part}> · {part}</span>
      ))}
    </p>
  );
}

function HeaderTools({ locale, data, dark }: { locale: Locale; data: ShellData; dark?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <LanguageSwitcher current={locale} tone={dark ? "dark" : "light"} />
      <AccountMenu
        displayName={data.session.displayName}
        switchBranchHref={data.switchBranchHref}
      />
    </div>
  );
}

export async function StaffShell({ locale, data, children }: AuthedShellProps) {
  return (
    <SessionProvider value={data.session}>
      <SessionWatcher />
      <div className="flex min-h-dvh flex-col bg-cream-100">
        <SkipLink locale={locale} />
        <header className="sticky top-0 z-10 bg-green-800 px-3 py-2 text-white">
          <div className="mx-auto flex w-full max-w-xl flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <Brand locale={locale} light />
            <HeaderTools locale={locale} data={data} dark />
          </div>
          <div className="mx-auto mt-1 w-full max-w-xl">
            <WhoAndWhere data={data} light />
          </div>
        </header>
        <div className="mx-auto w-full max-w-xl px-3 pt-3">
          <AreaNav items={data.nav} label={data.navLabel} />
        </div>
        <main id="main" className="mx-auto w-full max-w-xl flex-1 px-3 py-4">
          {children}
        </main>
      </div>
    </SessionProvider>
  );
}

export async function MerchantShell({ locale, data, children }: AuthedShellProps) {
  return (
    <SessionProvider value={data.session}>
      <SessionWatcher />
      <div className="flex min-h-dvh flex-col">
        <SkipLink locale={locale} />
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
            <div className="min-w-0">
              <Brand locale={locale} />
              <WhoAndWhere data={data} />
            </div>
            <HeaderTools locale={locale} data={data} />
          </div>
        </header>
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 md:flex-row md:gap-6">
          <AreaNav items={data.nav} label={data.navLabel} orientation="vertical" />
          <main id="main" className="min-w-0 flex-1">
            {children}
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}

export async function OperationsShell({ locale, data, children }: AuthedShellProps) {
  const t = await getTranslator(locale);
  return (
    <SessionProvider value={data.session}>
      <SessionWatcher />
      <div className="flex min-h-dvh flex-col">
        <SkipLink locale={locale} />
        <header className="bg-charcoal-900 text-white">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <Brand locale={locale} light />
              <span className="rounded-md bg-gold-500 px-2 py-0.5 text-xs font-bold tracking-wide text-charcoal-900 uppercase">
                {t("areas.operations")}
              </span>
            </div>
            <HeaderTools locale={locale} data={data} dark />
          </div>
          <div className="mx-auto w-full max-w-6xl px-4 pb-2">
            <WhoAndWhere data={data} light />
          </div>
        </header>
        <div className="border-b border-border bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 py-2">
            <AreaNav items={data.nav} label={data.navLabel} />
          </div>
        </div>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {children}
        </main>
      </div>
    </SessionProvider>
  );
}
