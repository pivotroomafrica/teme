import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The analytics page in a real browser against the mock backend (whose numbers obey the backend's definitions).
 * Read-only, so nothing here changes any data.
 */
async function signIn(page: Page, email: string, path: string, locale = "en") {
  await page.goto(`/${locale}/login`);
  await page.locator('form[data-hydrated="true"]').waitFor();
  await page.getByLabel(/^(Email address|የኢሜይል አድራሻ)/).fill(email);
  await page.getByLabel(/^(Password|የይለፍ ቃል)/).fill("mock-password-1");
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/\/(dashboard|staff\/branch)$/);
  await page.goto(`/${locale}${path}`);
}

test.describe("analytics", () => {
  test("shows the north star first, then supporting sections, with no money or export", async ({
    page,
  }) => {
    await signIn(page, "owner@mock.test", "/dashboard/analytics");
    await expect(page.getByRole("heading", { name: "Analytics", level: 1 })).toBeVisible();
    await expect(page.getByText("Monthly Returning Loyalty Customers").first()).toBeVisible();
    for (const id of ["headline", "branches", "staff", "cohorts", "wallet"]) {
      await expect(page.getByTestId(`section-${id}`)).toHaveAttribute("data-state", "ready");
    }
    await expect(page.getByRole("table", { name: "Retention cohorts" })).toBeVisible();
    await expect(page.getByRole("button", { name: /export|download|csv/i })).toHaveCount(0);
    const text = (await page.locator("main").innerText()).replace(
      /This page covers.*?figures\./,
      "",
    );
    expect(text).not.toMatch(/\bETB\b|\bbirr\b|revenue|payment|billing/i);
  });

  test("changes the period, shows an empty period clearly, and pages staff", async ({ page }) => {
    await signIn(page, "owner@mock.test", "/dashboard/analytics");
    await page
      .getByTestId("date-range")
      .getByLabel("Period")
      .selectOption({ label: "Last 7 days" });
    await expect(page).toHaveURL(/range=last7/);
    await expect(page.getByTestId("range-summary")).toContainText("Africa/Addis_Ababa");

    await page.getByRole("button", { name: "Show more" }).click();
    await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);

    await page.goto("/en/dashboard/analytics?from=2025-01-01&to=2025-01-31");
    await expect(page.getByText(/Nothing happened in this period/)).toBeVisible();
    await expect(page.getByText("No staff activity in this period.")).toBeVisible();
  });

  test("every chart has a description and a table alternative", async ({ page }) => {
    await signIn(page, "owner@mock.test", "/dashboard/analytics");
    await expect(page.getByTestId("section-wallet")).toHaveAttribute("data-state", "ready");
    const charts = page.locator('main svg[role="img"]');
    await expect(charts).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) {
      await expect(charts.nth(i).locator("desc")).not.toBeEmpty();
    }
    const toggles = page.getByRole("button", { name: "Show as a table" });
    await expect(toggles).toHaveCount(3);
    await toggles.first().click();
    await expect(page.getByRole("table").first()).toBeVisible();
  });

  test("no sideways scrolling and no accessibility violations", async ({ page }) => {
    await signIn(page, "owner@mock.test", "/dashboard/analytics");
    await expect(page.getByTestId("section-cohorts")).toHaveAttribute("data-state", "ready");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });

  test("works in Amharic with no missing translations", async ({ page }) => {
    const missing: string[] = [];
    page.on("console", (m) => {
      if (m.text().includes("[i18n] Missing")) missing.push(m.text());
    });
    await signIn(page, "owner@mock.test", "/dashboard/analytics", "am");
    await expect(page.getByRole("table", { name: "የሠራተኞች እንቅስቃሴ" })).toBeVisible();
    expect(missing).toEqual([]);
  });

  test("an account without analytics access is turned away from the page", async ({ page }) => {
    await signIn(page, "staff@mock.test", "/dashboard/analytics");
    expect(page.url()).not.toMatch(/\/dashboard\/analytics$/);
  });
});
