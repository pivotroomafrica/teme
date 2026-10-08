import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { seal, unseal } from "../../src/lib/auth/seal";
import type { SessionData } from "../../src/lib/auth/session-data";

/**
 * Real sign-in flows in a real browser against the mock backend (TC_API_MODE=mock, see playwright.config.ts).
 * Accounts: tests/../src/mocks/README.md. Password for all: mock-password-1.
 */
const PASSWORD = "mock-password-1";
const SECRET = "e2e-only-Zq8vN3tK1xW6pL9sD2fG5hJ7mB4cR0yU";
const ROLES = {
  owner: {
    email: "owner@mock.test",
    home: "/en/dashboard",
    label: "Owner",
    menuName: /Hana Owner/,
  },
  manager: {
    email: "manager@mock.test",
    home: "/en/dashboard",
    label: "Manager",
    menuName: /Dawit Manager/,
  },
  staff: {
    email: "staff@mock.test",
    home: "/en/staff/scanner",
    label: "Branch staff",
    menuName: /Selam Cashier/,
  },
  admin: {
    email: "admin@mock.test",
    home: "/en/operations",
    label: "Platform administrator",
    menuName: /Operations Admin/,
  },
} as const;
type Role = keyof typeof ROLES;

async function signIn(page: Page, role: Role, options: { next?: string; locale?: string } = {}) {
  const locale = options.locale ?? "en";
  await page.goto(
    `/${locale}/login${options.next ? `?next=${encodeURIComponent(options.next)}` : ""}`,
  );
  await page.locator('form[data-hydrated="true"]').waitFor();
  await page.getByLabel(/^(Email address|የኢሜይል አድራሻ)/).fill(ROLES[role].email);
  await page.getByLabel(/^(Password|የይለፍ ቃል)/).fill(PASSWORD);
  await page.locator("form button[type=submit]").click();
}

/** Staff have two branches: choose one so the scanner opens. */
async function signInReady(page: Page, role: Role) {
  await signIn(page, role);
  if (role === "staff") {
    // In a fresh browser staff always meet the branch chooser first (the scanner redirects there).
    await page.waitForURL(/\/en\/staff\/branch$/);
    await page.locator('main [data-hydrated="true"]').waitFor();
    await page.getByRole("radio", { name: "Bole" }).check();
    await page.getByRole("button", { name: "Use this branch" }).click();
    await page.waitForURL(/\/en\/staff\/scanner$/);
  } else {
    await page.waitForURL((url) => url.pathname === ROLES[role].home);
  }
  // The page is interactive once the account menu (a client component) is there.
  await page.getByRole("button", { name: ROLES[role].menuName }).waitFor();
}

const sessionCookie = async (context: BrowserContext) =>
  (await context.cookies()).find((c) => c.name === "tc_session");

test.describe("signing in", () => {
  test("checks the form before sending anything, in English and Amharic", async ({ page }) => {
    await page.goto("/en/login");
    await page.locator('form[data-hydrated="true"]').waitFor();
    await page.locator("form button[type=submit]").click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();
    await page.getByLabel(/^Email address/).fill("not-an-email");
    await page.locator("form button[type=submit]").click();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();

    await page.goto("/am/login");
    await page.locator('form[data-hydrated="true"]').waitFor();
    await page.locator("form button[type=submit]").click();
    await expect(page.getByText("የኢሜይል አድራሻዎን ያስገቡ።")).toBeVisible();
  });

  test("gives the same answer for a wrong password and an unknown account, and keeps nothing", async ({
    page,
    context,
  }) => {
    const messages: string[] = [];
    for (const email of ["owner@mock.test", "nobody@mock.test"]) {
      await page.goto("/en/login");
      await page.locator('form[data-hydrated="true"]').waitFor();
      await page.getByLabel(/^Email address/).fill(email);
      await page.getByLabel(/^Password/).fill("wrong-password");
      await page.locator("form button[type=submit]").click();
      // Next.js adds its own empty role=alert route announcer, so look inside the form.
      const alert = page.locator('form [role="alert"]');
      await expect(alert).toBeVisible();
      messages.push((await alert.textContent()) ?? "");
      await expect(page).toHaveURL(/\/en\/login$/);
    }
    expect(messages[0]).toBe(messages[1]);
    expect(messages[0]).toContain("The email address or password is not correct.");
    expect(await sessionCookie(context)).toBeUndefined();
  });

  test("never puts the password in the address bar, even if the form is submitted natively", async ({
    page,
  }) => {
    await page.goto("/en/login");
    const form = page.locator("form");
    await expect(form).toHaveAttribute("method", "post");
    await expect(form).toHaveAttribute("action", "/api/session/login");
    await page.getByLabel(/^Password/).fill("super-secret-value");
    expect(page.url()).not.toContain("super-secret-value");
  });

  test("shows and hides the password on request", async ({ page }) => {
    await page.goto("/en/login");
    await page.locator('form[data-hydrated="true"]').waitFor();
    const input = page.getByLabel(/^Password/);
    await expect(input).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(input).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  for (const role of Object.keys(ROLES) as Role[]) {
    test(`${role} lands on their own home page, showing who and where`, async ({ page }) => {
      await signInReady(page, role);
      const context = page.getByTestId("shell-context");
      await expect(context).toContainText(ROLES[role].label);
      if (role === "owner" || role === "manager")
        await expect(context).toContainText("Sample Cafe");
      if (role === "staff") await expect(context).toContainText("Bole");
      await expect(
        page.getByRole("button", { name: /Owner|Manager|Selam|Hana|Dawit|Operations/ }).first(),
      ).toBeVisible();
    });
  }

  test("returns to the page the person wanted, but never to another site or a forbidden page", async ({
    page,
  }) => {
    await signIn(page, "owner", { next: "/en/dashboard/analytics" });
    await expect(page).toHaveURL(/\/en\/dashboard\/analytics$/);
  });

  for (const next of [
    "//evil.example/phish",
    "https://evil.example",
    "/\\evil.example",
    "/en/operations",
  ]) {
    test(`ignores the unsafe or forbidden destination ${next}`, async ({ page }) => {
      await signIn(page, "owner", { next });
      await page.waitForURL(/\/en\/dashboard$/);
      expect(new URL(page.url()).origin).toBe(
        new URL(await page.evaluate(() => location.href)).origin,
      );
    });
  }

  test("a signed-in person visiting the sign-in page is taken home", async ({ page }) => {
    await signInReady(page, "owner");
    await page.goto("/en/login");
    await expect(page).toHaveURL(/\/en\/dashboard$/);
  });
});

const NAV: Record<Role, string[]> = {
  owner: [
    "Overview",
    "Program",
    "Branches",
    "Team",
    "Customers",
    "Rewards",
    "Campaigns",
    "Analytics",
    "Audit history",
    "Settings",
  ],
  manager: [
    "Overview",
    "Program",
    "Branches",
    "Team",
    "Customers",
    "Rewards",
    "Campaigns",
    "Analytics",
    "Audit history",
    "Settings",
  ],
  staff: ["Scanner", "Branch"],
  admin: [
    "Overview",
    "Merchants",
    "Fraud monitoring",
    "Wallet health",
    "Privacy requests",
    "Audit history",
    "System",
  ],
};

test.describe("navigation shows only what each role may open", () => {
  for (const role of Object.keys(ROLES) as Role[]) {
    test(`${role}`, async ({ page, isMobile }) => {
      await signInReady(page, role);
      const nav = page.getByRole("navigation", { name: "Menu" });
      await expect(nav).toHaveAttribute("data-hydrated", "true");
      if (isMobile && NAV[role].length > 1) await nav.getByRole("button", { name: "Menu" }).click();
      const names = await nav.getByRole("link").allTextContents();
      expect(names).toEqual(NAV[role]);
    });
  }
});

/** [role, path, allowed] */
const ACCESS: Array<[Role, string, boolean]> = [
  ["owner", "/en/dashboard/audit", true],
  ["owner", "/en/staff/scanner", true],
  ["owner", "/en/operations", false],
  ["manager", "/en/dashboard/analytics", true],
  ["manager", "/en/operations/fraud", false],
  ["staff", "/en/staff/scanner", true],
  ["staff", "/en/dashboard", false],
  ["staff", "/en/dashboard/customers", false],
  ["staff", "/en/dashboard/program", false],
  ["staff", "/en/operations", false],
  ["admin", "/en/operations/audit", true],
  ["admin", "/en/operations/system", true],
  ["admin", "/en/dashboard", false],
  ["admin", "/en/dashboard/analytics", false],
  ["admin", "/en/staff/scanner", false],
];

test.describe("route access by role (typing the address, not just clicking)", () => {
  for (const [role, path, allowed] of ACCESS) {
    test(`${role} ${allowed ? "can open" : "is turned away from"} ${path}`, async ({ page }) => {
      await signInReady(page, role);
      await page.goto(path);
      if (allowed) {
        expect(new URL(page.url()).pathname).not.toMatch(/denied|login/);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      } else {
        await expect(page).toHaveURL(/\/en\/denied$/);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("You do not have access");
        // The page says nothing about what lives at the address.
        await expect(page.locator("body")).not.toContainText(/analytics|audit|fraud|scanner/i);
        await expect(page.getByRole("link", { name: "Go to my home page" })).toHaveAttribute(
          "href",
          ROLES[role].home,
        );
      }
    });
  }
});

test.describe("signing out", () => {
  test("ends this browser's session and clears the cookie", async ({ page, context }) => {
    await signInReady(page, "manager");
    expect(await sessionCookie(context)).toBeDefined();
    await page.getByRole("button", { name: /Dawit Manager/ }).click();
    await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/en\/session-expired\?reason=signed-out/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You are signed out");
    expect(await sessionCookie(context)).toBeUndefined();
    await page.goto("/en/dashboard");
    await expect(page).toHaveURL(/\/en\/login\?next=/);
  });

  test("'log out of all devices' asks first, then ends every session", async ({
    page,
    context,
  }) => {
    await signInReady(page, "owner");
    await page.getByRole("button", { name: /Hana Owner/ }).click();
    await page.getByRole("menuitem", { name: "Log out of all devices" }).click();
    const dialog = page.getByRole("dialog", { name: "Log out of all devices?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(await sessionCookie(context)).toBeDefined();

    await page.getByRole("button", { name: /Hana Owner/ }).click();
    await page.getByRole("menuitem", { name: "Log out of all devices" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Log out of all devices" }).click();
    await expect(page).toHaveURL(/reason=revoked/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You were signed out");
    expect(await sessionCookie(context)).toBeUndefined();
  });

  test("explains each way a session can end", async ({ page }) => {
    const cases: Array<[string, string]> = [
      ["expired", "Your session has ended"],
      ["deactivated", "This account is no longer active"],
      ["revoked", "You were signed out"],
      ["signed-out", "You are signed out"],
      ["unknown-reason", "Your session has ended"],
    ];
    for (const [reason, title] of cases) {
      await page.goto(`/en/session-expired?reason=${reason}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
        "href",
        "/en/login",
      );
    }
  });
});

test.describe("the session cookie", () => {
  test("is sealed, HttpOnly and invisible to page scripts and storage", async ({
    page,
    context,
  }) => {
    await signInReady(page, "owner");
    const cookie = await sessionCookie(context);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    expect(cookie!.value).toMatch(/^v1\./);
    expect(cookie!.value).not.toContain("mock-access");
    const exposed = await page.evaluate(() => ({
      cookie: document.cookie,
      local: JSON.stringify({ ...localStorage }),
      session: JSON.stringify({ ...sessionStorage }),
    }));
    expect(exposed.cookie).not.toContain("tc_session");
    for (const text of Object.values(exposed))
      expect(text).not.toMatch(/mock-access|mock-refresh|accessToken|refreshToken/);
  });

  test("never appears in a page or a data response", async ({ page }) => {
    const bodies: string[] = [];
    page.on("response", async (r) => {
      if (
        r.url().includes("localhost") &&
        /html|json|javascript|text/.test(r.headers()["content-type"] ?? "")
      ) {
        bodies.push(await r.text().catch(() => ""));
      }
    });
    await signInReady(page, "owner");
    await page.goto("/en/dashboard/analytics");
    await page.waitForLoadState("networkidle");
    expect(bodies.join("\n")).not.toMatch(/mock-access\.|mock-refresh\./);
  });
});

test.describe("sessions that age or are revoked", () => {
  async function replaceSession(
    context: BrowserContext,
    change: (data: SessionData) => SessionData,
  ) {
    const current = await sessionCookie(context);
    const data = (await unseal<SessionData>(current!.value, SECRET))!;
    await context.addCookies([{ ...current!, value: await seal(change(data), SECRET) }]);
    return data;
  }

  test("renews an expiring session without the person noticing", async ({ page, context }) => {
    await signInReady(page, "owner");
    const before = await replaceSession(context, (d) => ({
      ...d,
      accessExpiresAt: Date.now() - 1000,
    }));
    await page.goto("/en/dashboard/analytics");
    await expect(page).toHaveURL(/\/en\/dashboard\/analytics$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Analytics");
    const after = (await unseal<SessionData>((await sessionCookie(context))!.value, SECRET))!;
    expect(after.refreshToken).not.toBe(before.refreshToken);
    expect(after.accessExpiresAt).toBeGreaterThan(Date.now() + 600_000);
    expect(after.issuedAt).toBe(before.issuedAt);
  });

  test("signs the person out, with an explanation, when the backend revokes the session", async ({
    page,
    context,
  }) => {
    await signInReady(page, "owner");
    await replaceSession(context, (d) => ({ ...d, accessToken: "mock-access.revoked@mock.test" }));
    await page.goto("/en/dashboard");
    await expect(page).toHaveURL(/\/en\/session-expired\?reason=revoked/);
    expect(await sessionCookie(context)).toBeUndefined();
  });

  test("ends a session whose refresh token the backend no longer accepts", async ({
    page,
    context,
  }) => {
    await signInReady(page, "owner");
    await replaceSession(context, (d) => ({
      ...d,
      refreshToken: "mock-refresh.owner@mock.test.revoked",
      accessExpiresAt: Date.now() - 1000,
    }));
    await page.goto("/en/dashboard");
    await expect(page).toHaveURL(/\/en\/session-expired\?reason=expired/);
    expect(await sessionCookie(context)).toBeUndefined();
  });

  test("treats a session past the absolute limit as signed out", async ({ page, context }) => {
    await signInReady(page, "owner");
    await replaceSession(context, (d) => ({ ...d, issuedAt: Date.now() - 31 * 86_400_000 }));
    await page.goto("/en/dashboard");
    await expect(page).toHaveURL(/\/en\/login\?next=/);
  });

  test("a cookie someone forged or copied from another deployment grants nothing", async ({
    page,
    context,
  }) => {
    await signInReady(page, "owner");
    const current = await sessionCookie(context);
    const data = (await unseal<SessionData>(current!.value, SECRET))!;
    await context.addCookies([
      {
        ...current!,
        value: await seal(
          { ...data, user: { ...data.user, kind: "platform" } },
          "another-secret-another-secret-12345",
        ),
      },
    ]);
    await page.goto("/en/operations");
    await expect(page).toHaveURL(/\/en\/login\?next=/);
  });
});

test.describe("branch selection for staff", () => {
  test("asks which branch, remembers it, shows it, and lets staff switch", async ({
    page,
    context,
  }) => {
    await signIn(page, "staff");
    await expect(page).toHaveURL(/\/en\/staff\/branch$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose your branch");
    await page.locator('main [data-hydrated="true"]').waitFor();
    await expect(page.getByRole("radio")).toHaveCount(2);
    await page.getByRole("radio", { name: "Piassa" }).check();
    await page.getByRole("button", { name: "Use this branch" }).click();
    await expect(page).toHaveURL(/\/en\/staff\/scanner$/);
    await expect(page.getByTestId("shell-context")).toContainText("Piassa");
    const branch = (await context.cookies()).find((c) => c.name === "tc_branch");
    expect(branch).toMatchObject({ httpOnly: true });

    await page.goto("/en/staff/scanner");
    await expect(page.getByTestId("shell-context")).toContainText("Piassa");
    await page.getByRole("button", { name: /Selam Cashier/ }).click();
    await page.getByRole("menuitem", { name: "Switch branch" }).click();
    await expect(page).toHaveURL(/\/en\/staff\/branch$/);
    await expect(page.getByRole("radio", { name: "Piassa" })).toBeChecked();
  });

  test("owners and managers have no branch switcher", async ({ page }) => {
    await signInReady(page, "owner");
    await page.getByRole("button", { name: /Hana Owner/ }).click();
    await expect(page.getByRole("menuitem", { name: "Switch branch" })).toHaveCount(0);
  });
});

test.describe("language and layout when signed in", () => {
  test("shows Amharic role labels, navigation and business names", async ({ page, isMobile }) => {
    await signIn(page, "owner", { locale: "am" });
    await page.waitForURL(/\/am\/dashboard$/);
    await expect(page.getByTestId("shell-context")).toContainText("ባለቤት");
    await expect(page.getByTestId("shell-context")).toContainText("ናሙና ቡና ቤት");
    const nav = page.getByRole("navigation", { name: "ምናሌ" });
    await expect(nav).toHaveAttribute("data-hydrated", "true");
    if (isMobile) await nav.getByRole("button", { name: "ምናሌ" }).click();
    await expect(nav.getByRole("link", { name: "ደንበኞች" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "am");
  });

  test("folds the dashboard menu on phones and never scrolls sideways", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "phone viewport only");
    for (const locale of ["en", "am"]) {
      await signIn(page, "owner", { locale });
      await page.waitForURL(new RegExp(`/${locale}/dashboard$`));
      const toggle = page.getByRole("button", { name: locale === "en" ? "Menu" : "ምናሌ" });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(
        page.getByRole("link", { name: locale === "en" ? "Analytics" : "ትንታኔ" }),
      ).toBeHidden();
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(
        page.getByRole("link", { name: locale === "en" ? "Analytics" : "ትንታኔ" }),
      ).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, locale).toBeLessThanOrEqual(0);
      await page.context().clearCookies();
    }
  });

  for (const role of Object.keys(ROLES) as Role[]) {
    for (const locale of ["en", "am"]) {
      test(`${role} pages have no accessibility violations (${locale})`, async ({ page }) => {
        await signIn(page, role, { locale });
        await page.waitForURL(
          role === "staff"
            ? `**/${locale}/staff/branch`
            : new RegExp(`/${locale}/(dashboard|operations)`),
        );
        if (page.url().includes("/staff/branch"))
          await expect(page.getByRole("radio").first()).toBeVisible();
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      });
    }
  }
});
