import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** The merchant dashboard overview in a real browser against the mock backend. */
async function signIn(page: Page, email: string, locale = "en") {
  await page.goto(`/${locale}/login`);
  await page.locator('form[data-hydrated="true"]').waitFor();
  await page.getByLabel(/^(Email address|የኢሜይል አድራሻ)/).fill(email);
  await page.getByLabel(/^(Password|የይለፍ ቃል)/).fill("mock-password-1");
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(new RegExp(`/${locale}/dashboard$`));
}

const card = (page: Page, name: string) => page.getByRole("article", { name });
const OWNER = "owner@mock.test";

async function loaded(page: Page) {
  await expect(card(page, "New members")).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("section-trend")).toHaveAttribute("data-state", "ready");
  await expect(page.getByTestId("section-events")).toHaveAttribute("data-state", "ready");
}

test.describe("the overview", () => {
  test("shows the business, every headline figure and every section", async ({ page }) => {
    await signIn(page, OWNER);
    await loaded(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Overview");
    await expect(page.getByText("Sample Cafe").first()).toBeVisible();

    for (const name of [
      "Monthly Returning Loyalty Customers",
      "New members",
      "Active members",
      "Stamps issued",
      "Rewards unlocked",
      "Rewards redeemed",
      "Redemption rate",
    ]) {
      await expect(card(page, name)).toBeVisible();
    }
    await expect(card(page, "New members")).toContainText("90"); // 30 days in the mock
    await expect(card(page, "Redemption rate")).toContainText("%");
    await expect(page.getByRole("heading", { name: "Returning customers by month" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Branch activity" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Wallet update health" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent operational events" })).toBeVisible();
    await expect(page.getByTestId("range-summary")).toContainText("time zone: Africa/Addis_Ababa");
  });

  test("a manager sees it too", async ({ page }) => {
    await signIn(page, "manager@mock.test");
    await loaded(page);
    await expect(card(page, "Active members")).toBeVisible();
  });

  test("never mentions money", async ({ page }) => {
    await signIn(page, OWNER);
    await loaded(page);
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(
      /revenue|sales|order value|average order|payment|billing|subscription|price|\bETB\b|\bbirr\b|\$/i,
    );
  });

  test("works in Amharic", async ({ page }) => {
    await signIn(page, OWNER, "am");
    await expect(page.getByRole("article", { name: "አዲስ አባላት" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "ቦሌ" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "የቅርንጫፍ እንቅስቃሴ" })).toBeVisible();
  });

  test("has no accessibility violations in either language", async ({ page }) => {
    for (const locale of ["en", "am"]) {
      await signIn(page, OWNER, locale);
      if (locale === "en") await loaded(page);
      else await expect(page.getByTestId("section-events")).toHaveAttribute("data-state", "ready");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations.map((v) => `${locale} ${v.id}: ${v.help}`)).toEqual([]);
      await page.context().clearCookies();
    }
  });
});

test.describe("date range", () => {
  test("changing the period asks the backend for those days and survives a reload", async ({
    page,
  }) => {
    const asked: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/analytics/overview")) asked.push(r.url());
    });
    await signIn(page, OWNER);
    await loaded(page);

    await page.getByRole("combobox", { name: "Period" }).selectOption("last7");
    await expect(page).toHaveURL(/\?range=last7$/);
    await expect(card(page, "New members")).toContainText("21"); // 7 days in the mock
    const last = new URL(asked.at(-1)!);
    const from = last.searchParams.get("from")!;
    const to = last.searchParams.get("to")!;
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBe(6);

    await page.reload();
    await expect(page.getByRole("combobox", { name: "Period" })).toHaveValue("last7");
    await expect(card(page, "New members")).toContainText("21");
  });

  test("custom dates are checked before anything is sent", async ({ page }) => {
    await signIn(page, OWNER);
    await loaded(page);
    await page.getByRole("combobox", { name: "Period" }).selectOption("custom");
    await page.getByLabel("From", { exact: true }).fill("2026-10-09");
    await page.getByLabel("To", { exact: true }).fill("2026-10-01");
    await page.getByRole("button", { name: "Show", exact: true }).click();
    await expect(page.getByText("The start date must not be after the end date.")).toBeVisible();
    await expect(page).not.toHaveURL(/from=/);

    await page.getByLabel("From", { exact: true }).fill("2026-08-01");
    await page.getByLabel("To", { exact: true }).fill("2026-08-10");
    await page.getByRole("button", { name: "Show", exact: true }).click();
    await expect(page).toHaveURL(/from=2026-08-01&to=2026-08-10/);
    await expect(card(page, "New members")).toContainText("30"); // 10 days in the mock
    await expect(page.getByTestId("range-summary")).toContainText("Aug 1, 2026 to Aug 10, 2026");
  });

  test("an empty period is explained, not left blank", async ({ page }) => {
    await signIn(page, OWNER);
    await page.goto("/en/dashboard?from=2025-01-01&to=2025-01-31");
    await expect(page.getByText("No loyalty activity in this period yet.")).toBeVisible();
    await expect(page.getByText("No branch activity in this period.")).toBeVisible();
    await expect(card(page, "Redemption rate")).toContainText("—");
    await expect(card(page, "Redemption rate")).toContainText(
      "No rewards were unlocked in this period.",
    );
  });
});

test.describe("states", () => {
  test("shows each part as loading while it waits", async ({ page }) => {
    await page.route("**/api/bff/merchant/analytics/overview*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await signIn(page, OWNER);
    await expect(card(page, "New members")).toHaveAttribute("aria-busy", "true");
    await expect(card(page, "New members")).not.toHaveAttribute("aria-busy", "true", {
      timeout: 10_000,
    });
    await expect(card(page, "New members")).toContainText("90");
  });

  test("a failing section does not take the page down, and retrying recovers it", async ({
    page,
  }) => {
    await page.route("**/api/bff/merchant/analytics/branches*", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "HTTP_503", message: "down", requestId: "req-e2e-1" },
        }),
      }),
    );
    await signIn(page, OWNER);
    const branches = page.getByTestId("section-branches");
    await expect(branches).toHaveAttribute("data-state", "error");
    await expect(branches).toContainText("We could not load this section.");
    await expect(branches).toContainText("req-e2e-1");
    await expect(page.getByText("Some information could not be loaded")).toBeVisible();
    await expect(card(page, "New members")).toContainText("90");
    await expect(page.getByTestId("section-events")).toHaveAttribute("data-state", "ready");

    await page.unroute("**/api/bff/merchant/analytics/branches*");
    await branches.getByRole("button", { name: "Try again" }).click();
    await expect(branches).toHaveAttribute("data-state", "ready");
    await expect(page.getByText("Some information could not be loaded")).toHaveCount(0);
  });
});

test.describe("charts and tables", () => {
  test("the chart can be read as text and as a table", async ({ page }) => {
    await signIn(page, OWNER);
    await loaded(page);
    const chart = page.getByRole("img", { name: /Bar chart of returning loyalty customers/ });
    await expect(chart).toBeVisible();
    expect(await chart.getAttribute("aria-describedby")).toBeTruthy();
    await expect(page.getByTestId("bar")).toHaveCount(6);

    await page.getByRole("button", { name: "Show as a table" }).click();
    const table = page.getByRole("table", { name: "Returning customers by month" });
    await expect(table.getByRole("row")).toHaveCount(7);
    await expect(table).toContainText("(so far)");
    await expect(page.getByRole("button", { name: "Hide the table" })).toBeVisible();
  });

  test("the definitions are one click away", async ({ page }) => {
    await signIn(page, OWNER);
    await loaded(page);
    await page.getByText("What do these numbers mean?").click();
    await expect(page.getByText(/divided by rewards unlocked/)).toBeVisible();
  });
});

test.describe("layout and navigation", () => {
  const noSidewaysScroll = (page: Page) =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

  test("on a tablet the navigation is a side list and nothing overflows", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await signIn(page, OWNER);
    await loaded(page);
    const nav = page.getByRole("navigation", { name: "Menu" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "Branches" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Menu" })).toBeHidden();
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
  });

  test("on a phone the navigation folds behind a Menu button and nothing overflows", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page, OWNER);
    await loaded(page);
    const menu = page.getByRole("button", { name: "Menu" });
    await expect(menu).toBeVisible();
    await expect(page.getByRole("link", { name: "Branches" })).toBeHidden();
    await menu.click();
    await expect(page.getByRole("link", { name: "Branches" })).toBeVisible();
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
  });

  test("on a wide screen the figures sit in a grid", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, OWNER);
    await loaded(page);
    const a = await card(page, "New members").boundingBox();
    const b = await card(page, "Active members").boundingBox();
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(4); // side by side
  });
});
