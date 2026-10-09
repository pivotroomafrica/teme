import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Production-readiness checks on the signed-in app (development server, mock backend): accessibility over every
 * screen in both languages, keyboard and dialog behaviour, policy violations, what the browser stores, and duplicate
 * requests. Read-only: nothing here changes data.
 */
async function signIn(page: Page, email: string, path: string, locale = "en") {
  await page.goto(`/${locale}/login`);
  await page.locator('form[data-hydrated="true"]').waitFor();
  await page.getByLabel(/^(Email address|የኢሜይል አድራሻ)/).fill(email);
  await page.getByLabel(/^(Password|የይለፍ ቃል)/).fill("mock-password-1");
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/\/(dashboard|staff\/branch|operations)$/);
  if (path) await page.goto(`/${locale}${path}`);
}

const DASHBOARD = [
  "/dashboard",
  "/dashboard/program",
  "/dashboard/branches",
  "/dashboard/team",
  "/dashboard/customers",
  "/dashboard/rewards",
  "/dashboard/campaigns",
  "/dashboard/analytics",
  "/dashboard/audit",
  "/dashboard/fraud",
  "/dashboard/privacy",
  "/dashboard/settings",
];
const OPERATIONS = [
  "/operations",
  "/operations/merchants",
  "/operations/merchants/00000000-0000-4000-8000-0000000a0001",
  "/operations/fraud",
  "/operations/wallet-health",
  "/operations/privacy",
  "/operations/audit",
  "/operations/system",
];
const STAFF = ["/staff/branch", "/staff/scanner"];

async function settle(page: Page) {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function violations(page: Page) {
  const found = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  return found.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`);
}

test.describe("accessibility sweep: every screen, both languages", () => {
  test.setTimeout(180_000);
  for (const locale of ["en", "am"]) {
    test(`merchant dashboard (${locale})`, async ({ page }) => {
      await signIn(page, "owner@mock.test", "", locale);
      for (const path of DASHBOARD) {
        await page.goto(`/${locale}${path}`);
        await settle(page);
        expect(await violations(page), `${locale}${path}`).toEqual([]);
      }
    });

    test(`staff screens (${locale})`, async ({ page }) => {
      await signIn(page, "staff@mock.test", "", locale);
      for (const path of STAFF) {
        await page.goto(`/${locale}${path}`);
        await settle(page);
        expect(await violations(page), `${locale}${path}`).toEqual([]);
      }
    });

    test(`operations (${locale})`, async ({ page }) => {
      await signIn(page, "admin@mock.test", "", locale);
      for (const path of OPERATIONS) {
        await page.goto(`/${locale}${path}`);
        await settle(page);
        expect(await violations(page), `${locale}${path}`).toEqual([]);
      }
    });

    test(`public pages (${locale})`, async ({ page }) => {
      for (const path of [
        "",
        "/login",
        "/accept-invitation",
        "/join/sample-cafe",
        "/denied",
        "/session-expired",
      ]) {
        await page.goto(`/${locale}${path}`);
        await settle(page);
        expect(await violations(page), `${locale}${path}`).toEqual([]);
      }
    });
  }
});

test.describe("keyboard and focus", () => {
  test("the skip link is the first stop and moves focus to the main content", async ({ page }) => {
    await page.goto("/en/login");
    await page.locator('form[data-hydrated="true"]').waitFor();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
    // Focus continues from the main content, not from the top of the page.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("#main"))).toBe(true);
  });

  test("the sign-in form can be completed by keyboard alone, with labels on every field", async ({
    page,
  }) => {
    await page.goto("/en/login");
    await page.locator('form[data-hydrated="true"]').waitFor();
    for (const input of await page.locator("form input:not([type=hidden])").all()) {
      expect(await input.getAttribute("id")).toBeTruthy();
      await expect(page.locator(`label[for="${await input.getAttribute("id")}"]`)).toHaveCount(1);
    }
    await page.getByLabel(/^Email address/).focus();
    await page.keyboard.type("owner@mock.test");
    await page.keyboard.press("Tab");
    await page.keyboard.type("mock-password-1");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/dashboard$/);
  });

  test("a dialog traps focus, closes with Escape and gives focus back", async ({ page }) => {
    await signIn(page, "owner@mock.test", "/dashboard/team");
    const trigger = page.getByRole("button", { name: "Invite someone" });
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Invite a team member" });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      // Focus may leave the page for the browser's own controls (then it is on the body) but never lands on the
      // page behind the dialog.
      expect(
        await page.evaluate(
          () =>
            document.activeElement === document.body || !!document.activeElement?.closest("dialog"),
        ),
        `tab ${i}`,
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("errors are announced when they appear", async ({ page }) => {
    await page.goto("/en/login");
    await page.locator('form[data-hydrated="true"]').waitFor();
    await page.getByLabel(/^Email address/).fill("owner@mock.test");
    await page.getByLabel(/^Password/).fill("wrong-password");
    await page.locator("form button[type=submit]").click();
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("screen-reader labels exist in Amharic on icon-only controls", async ({ page }) => {
    await signIn(page, "owner@mock.test", "/dashboard/team", "am");
    await settle(page);
    const unnamed = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button, a, [role=button]"))
        .filter((el) => {
          const text = (el.textContent ?? "").trim();
          return (
            !text &&
            !el.getAttribute("aria-label") &&
            !el.getAttribute("aria-labelledby") &&
            !el.querySelector("img[alt]")
          );
        })
        .map((el) => el.outerHTML.slice(0, 100)),
    );
    expect(unnamed).toEqual([]);
    await expect(page.locator("html")).toHaveAttribute("lang", "am");
  });
});

test.describe("what the browser stores and sends", () => {
  test("no token or secret is kept in browser storage; the session cookie cannot be read by scripts", async ({
    page,
    context,
  }) => {
    await signIn(page, "owner@mock.test", "/dashboard/analytics");
    await settle(page);
    const stored = await page.evaluate(async () => ({
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
      databases: "databases" in indexedDB ? (await indexedDB.databases()).length : 0,
    }));
    expect(stored.local).toEqual([]);
    expect(stored.session).toEqual([]);
    expect(stored.databases).toBe(0);

    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === "tc_session");
    expect(session).toBeDefined();
    expect(session!.httpOnly).toBe(true);
    expect(session!.sameSite).toBe("Lax");
    for (const cookie of cookies) {
      if (/^tc_(session|card|branch)$/.test(cookie.name))
        expect(cookie.httpOnly, cookie.name).toBe(true);
    }
    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toMatch(/tc_session|tc_card|mock-access|eyJ/);
    const html = await page.content();
    expect(html).not.toContain("mock-access.");
    expect(html).not.toContain("mock-refresh.");
  });

  test("signed-in pages load and work with no policy violations", async ({ page }) => {
    const found: string[] = [];
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        (window as unknown as { __v: string[] }).__v = [
          ...((window as unknown as { __v?: string[] }).__v ?? []),
          `${event.violatedDirective} ${event.blockedURI}`,
        ];
      });
    });
    page.on("console", (m) => {
      if (/content security policy/i.test(m.text())) found.push(m.text());
    });
    await signIn(page, "owner@mock.test", "/dashboard");
    for (const path of [
      "/dashboard",
      "/dashboard/analytics",
      "/dashboard/customers",
      "/dashboard/program",
    ]) {
      await page.goto(`/en${path}`);
      await settle(page);
      found.push(
        ...(await page.evaluate(() => (window as unknown as { __v?: string[] }).__v ?? [])),
      );
    }
    expect(found).toEqual([]);
  });
});

test.describe("requests", () => {
  for (const path of ["/dashboard", "/dashboard/analytics", "/dashboard/customers"]) {
    test(`${path} asks the backend for each thing once`, async ({ page }) => {
      await signIn(page, "owner@mock.test", "");
      const counts = new Map<string, number>();
      page.on("requestfinished", (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith("/api/bff/")) {
          const key = `${request.method()} ${url.pathname}${url.search}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      });
      await page.goto(`/en${path}`);
      await settle(page);
      expect(counts.size).toBeGreaterThan(0);
      // The development server mounts every component twice on purpose (React Strict Mode), which asks twice; a
      // production build asks once. The unit tests count exact calls without Strict Mode. Here the ceiling is two,
      // so a query repeated by our own code (for example by two components with different keys) would show up.
      const repeated = [...counts].filter(([, n]) => n > 2);
      expect(repeated).toEqual([]);
    });
  }

  test("moving between pages does not repeat what is already loaded", async ({
    page,
    isMobile,
  }) => {
    await signIn(page, "owner@mock.test", "/dashboard");
    await settle(page);
    const requests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/bff/merchant/analytics/definitions"))
        requests.push(url.pathname);
    });
    const nav = page.getByRole("navigation", { name: "Menu" });
    await expect(nav).toHaveAttribute("data-hydrated", "true");
    if (isMobile) await nav.getByRole("button", { name: "Menu" }).click();
    await nav.getByRole("link", { name: "Analytics" }).click();
    await settle(page);
    // The definitions are cached for an hour, so the second page reuses them.
    expect(requests).toEqual([]);
  });
});

test.describe("accepting an invitation", () => {
  test("a wrong code is refused in words and nothing is revealed about codes", async ({ page }) => {
    await page.goto("/en/accept-invitation");
    await page.locator('form[data-hydrated="true"]').waitFor();
    await page.getByLabel(/^Invitation code/).fill("inv_not-a-real-code");
    await page.getByLabel(/^Choose a password/).fill("a-long-password-1");
    await page.getByLabel(/^Type the password again/).fill("a-long-password-1");
    await page.getByRole("button", { name: "Set password" }).click();
    await expect(page.getByText(/This invitation code is not valid/)).toBeVisible();
    expect(page.url()).not.toContain("inv_not-a-real-code");
    expect(page.url()).not.toContain("a-long-password-1");
  });

  test("the page is kept out of search results", async ({ request }) => {
    const response = await request.get("/en/accept-invitation");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
  });
});

test.describe("loading", () => {
  test("a slow dashboard shows its own loading state at once and the shell stays usable", async ({
    page,
  }) => {
    await signIn(page, "owner@mock.test", "");
    await page.route("**/api/bff/merchant/analytics/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto("/en/dashboard/analytics");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Menu" })).toBeVisible();
    await expect(page.getByTestId("section-headline")).toHaveAttribute("data-state", "loading");
    await expect(page.getByTestId("section-headline")).toHaveAttribute("data-state", "ready", {
      timeout: 15_000,
    });
  });
});
