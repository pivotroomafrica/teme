import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * The operations console in a real browser against the mock backend. There is a single platform-administrator
 * account, so its data is shared between the phone and desktop projects: only the desktop project changes anything
 * (re-queueing a job), and the phone project only reads.
 */
async function signIn(page: Page, email: string, path: string, locale = "en") {
  await page.goto(`/${locale}/login`);
  await page.locator('form[data-hydrated="true"]').waitFor();
  await page.getByLabel(/^(Email address|የኢሜይል አድራሻ)/).fill(email);
  await page.getByLabel(/^(Password|የይለፍ ቃል)/).fill("mock-password-1");
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/\/(dashboard|staff\/branch|operations)$/);
  await page.goto(`/${locale}${path}`);
}

const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 768;
const isMobile = (info: TestInfo) => info.project.name.includes("mobile");
const list = (page: Page) => (wide(page) ? page.getByRole("table") : page.getByTestId("card-list"));

test.describe("operations console", () => {
  test("the administrator lands in operations and sees only operations navigation", async ({
    page,
  }, info) => {
    await signIn(page, "admin@mock.test", "/operations");
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Menu" });
    await expect(nav).toHaveAttribute("data-hydrated", "true");
    if (isMobile(info)) await nav.getByRole("button", { name: "Menu" }).click();
    for (const name of [
      "Merchants",
      "Fraud monitoring",
      "Wallet health",
      "Privacy requests",
      "System",
    ]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
    for (const name of ["Customers", "Team", "Analytics", "Program"]) {
      await expect(nav.getByRole("link", { name })).toHaveCount(0);
    }
    await expect(page.getByTestId("jobs-PENDING")).toBeVisible();
    await expect(page.getByText("Approving merchants and changing their status")).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/revenue|billing|subscription|payment/i);
  });

  test("merchants: search, open one, and view its activity only after the recorded confirmation", async ({
    page,
  }) => {
    await signIn(page, "admin@mock.test", "/operations/merchants");
    await expect(list(page).first()).toBeVisible();
    await page.getByRole("searchbox", { name: "Search merchants" }).fill("bakery");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search merchants" }).fill("sample");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await list(page).getByRole("link", { name: /Open/ }).first().click();
    await expect(page.getByRole("heading", { name: "Sample Cafe" })).toBeVisible();
    await expect(page.getByText(/Organisation details only/)).toBeVisible();
    await expect(page.getByTestId("merchant-activity")).toHaveCount(0);

    await page.getByRole("button", { name: "Show recent activity" }).click();
    const dialog = page.getByRole("dialog", { name: "View this merchant's activity?" });
    await dialog.getByRole("button", { name: "View and record" }).click();
    await expect(page.getByTestId("merchant-activity")).toBeVisible();
    await expect(page.getByText("BAIT-AUDIT-TOKEN")).toHaveCount(0);
  });

  test("wallet health: the jobs that gave up, hidden credentials, and a confirmed retry", async ({
    page,
  }, info) => {
    await signIn(page, "admin@mock.test", "/operations/wallet-health");
    await expect(list(page).first()).toBeVisible();
    const html = await page.content();
    for (const bait of ["BAIT-SECRET-TOKEN", "BAIT.BEARER.VALUE", "BAIT-PASSWORD"]) {
      expect(html).not.toContain(bait);
    }
    await page
      .getByRole("button", { name: /Try again/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "Try this job again?" });
    await expect(dialog).toBeVisible();
    if (isMobile(info)) {
      await dialog.getByRole("button", { name: "Cancel" }).click();
      return;
    }
    const before = await page.getByTestId("jobs-DEAD").innerText();
    await dialog.getByRole("button", { name: "Try again now" }).click();
    await expect(page.getByText("The job was queued again.")).toBeVisible();
    await expect(page.getByTestId("jobs-DEAD")).not.toHaveText(before);
  });

  test("fraud and privacy pages state what is not offered, system shows the service state", async ({
    page,
  }) => {
    await signIn(page, "admin@mock.test", "/operations/fraud");
    await expect(page.getByText("Not available yet")).toBeVisible();
    await page.goto("/en/operations/privacy");
    await expect(page.getByText("Choose a merchant to see its privacy records.")).toBeVisible();
    await page.goto("/en/operations/system");
    await expect(page.getByText("The service is running")).toBeVisible();
    await expect(page.getByText("The service can reach its database")).toBeVisible();
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page.getByText(/Checked/)).toBeVisible();
  });

  test("the platform audit lists administrator events", async ({ page }) => {
    await signIn(page, "admin@mock.test", "/operations/audit");
    await expect(list(page).first()).toBeVisible();
    await page.getByLabel("Action").selectOption({ label: "outbox.job_requeued" });
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(list(page).getByText("outbox.job_requeued").first()).toBeVisible();
  });
});

test.describe("who cannot see it", () => {
  for (const email of ["owner@mock.test", "manager@mock.test", "staff@mock.test"]) {
    test(`${email} is turned away from every operations page and never sees an operations link`, async ({
      page,
    }) => {
      await signIn(page, email, email.startsWith("staff") ? "/staff/branch" : "/dashboard");
      await expect(page.locator('a[href*="/operations"]')).toHaveCount(0);
      for (const path of [
        "/operations",
        "/operations/merchants",
        "/operations/merchants/00000000-0000-4000-8000-0000000a0001",
        "/operations/wallet-health",
        "/operations/audit",
        "/operations/system",
      ]) {
        await page.goto(`/en${path}`);
        await expect(page).toHaveURL(/\/en\/denied$/);
      }
    });
  }

  test("the administrator cannot open merchant pages", async ({ page }) => {
    await signIn(page, "admin@mock.test", "/dashboard/customers");
    await expect(page).toHaveURL(/\/en\/denied$/);
  });

  test("the proxy refuses platform calls without a session", async ({ request }) => {
    const response = await request.get("/api/bff/platform/merchants");
    expect([401, 403]).toContain(response.status());
  });
});

test.describe("layout and language", () => {
  for (const path of [
    "/operations",
    "/operations/merchants",
    "/operations/wallet-health",
    "/operations/audit",
    "/operations/system",
  ]) {
    test(`${path}: no sideways scrolling and no accessibility violations`, async ({ page }) => {
      await signIn(page, "admin@mock.test", path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("main").first()).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    });
  }

  test("Amharic has no missing translations", async ({ page }) => {
    const missing: string[] = [];
    page.on("console", (m) => {
      if (m.text().includes("[i18n] Missing")) missing.push(m.text());
    });
    await signIn(page, "admin@mock.test", "/operations", "am");
    await expect(page.getByText("አገልግሎቱ ገና የማያቀርባቸው")).toBeVisible();
    await page.goto("/am/operations/merchants");
    await expect(list(page).getByText("ናሙና ካፌ").first()).toBeVisible();
    expect(missing).toEqual([]);
  });
});
