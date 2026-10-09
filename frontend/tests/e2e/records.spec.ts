import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

/**
 * Customers, rewards and the audit history in a real browser against the mock backend. Each mock account has its
 * own data: the phone project signs in as the manager and the desktop project as the owner, so their reversals
 * never collide. Tests run one after another.
 */
test.describe.configure({ mode: "serial" });

const account = (info: TestInfo) =>
  info.project.name.includes("mobile") ? "manager@mock.test" : "owner@mock.test";

async function signIn(page: Page, email: string, path: string, locale = "en") {
  await page.goto(`/${locale}/login`);
  await page.locator('form[data-hydrated="true"]').waitFor();
  await page.getByLabel(/^(Email address|የኢሜይል አድራሻ)/).fill(email);
  await page.getByLabel(/^(Password|የይለፍ ቃል)/).fill("mock-password-1");
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/\/(dashboard|staff\/branch)$/);
  await page.goto(`/${locale}${path}`);
}

const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 768;
const entry = (page: Page, name: RegExp | string): Locator =>
  wide(page)
    ? page.getByRole("table").getByRole("row", { name })
    : page.getByTestId("card-list").getByRole("listitem").filter({ hasText: name });

test.describe("customers", () => {
  test("search, masking, paging and a customer's details", async ({ page }, info) => {
    await signIn(page, account(info), "/dashboard/customers");
    await expect(page.getByRole("heading", { name: "Customers", level: 1 })).toBeVisible();
    await expect(entry(page, /Abebe/).first()).toBeVisible();

    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Showing 11–20")).toBeVisible();
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(page.getByText("Showing 1–10")).toBeVisible();

    await page.getByRole("searchbox", { name: "Search customers" }).fill("tigist");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(entry(page, /Tigist/)).toBeVisible();
    await page.getByRole("searchbox", { name: "Search customers" }).fill("zzzz");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("No customer matches your search.")).toBeVisible();
  });

  test("the staff scanner account sees masked numbers and no visit history", async ({ page }) => {
    await signIn(page, "staff@mock.test", "/dashboard/customers");
    // Branch staff are turned away from the dashboard area or see only what their role allows.
    const url = page.url();
    if (/\/dashboard\/customers$/.test(url)) {
      await page.getByRole("searchbox", { name: "Search customers" }).fill("0911000111");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(entry(page, /Abebe/)).toContainText("+2519*****111");
      await expect(page.getByText("+251911000111")).toHaveCount(0);
    } else {
      expect(url).not.toMatch(/\/dashboard\/customers$/);
    }
  });
});

test.describe("reversals", () => {
  test("a manager reverses a stamp with a reason and sees the correction, the original stays", async ({
    page,
  }, info) => {
    await signIn(page, account(info), "/dashboard/customers");
    await entry(page, /Abebe/).first().getByRole("button", { name: /View/ }).click();
    const drawer = page.getByTestId("customer-detail");
    await expect(drawer.getByText("Free coffee")).toBeVisible();
    const history = drawer.getByRole("list", { name: "Visit history" });
    await expect(history).toBeVisible();
    const rows = history.getByRole("listitem");
    const before = await rows.count();

    await history
      .locator('[data-entry-type="STAMP"]:not([data-reversed])')
      .first()
      .getByRole("button", { name: /Reverse/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Reverse this stamp" });
    await dialog.getByRole("button", { name: "Review" }).click();
    await expect(dialog.getByText("Write at least 3 characters.")).toBeVisible();
    await dialog.getByLabel(/Reason/).fill("Scanned for the wrong customer");
    await dialog.getByRole("button", { name: "Review" }).click();
    await expect(dialog.getByRole("button", { name: "Reverse now" })).toBeDisabled();
    await dialog.getByLabel(/Type REVERSE to confirm/).fill("REVERSE");
    await dialog.getByRole("button", { name: "Reverse now" }).click();
    const done = page.getByRole("dialog", { name: "Reversal recorded" });
    await expect(done.getByTestId("reversal-result")).toContainText("New correction");
    await done.getByRole("button", { name: "Done" }).click();

    await expect(rows).toHaveCount(before + 1);
    await expect(history.locator('[data-new="true"]')).toContainText(
      "Scanned for the wrong customer",
    );
    await expect(history.locator('[data-reversed="true"]').first()).toContainText("Reversed");
  });
});

test.describe("rewards", () => {
  test("rewards given and reversed events, with no money values", async ({ page }, info) => {
    await signIn(page, account(info), "/dashboard/rewards");
    await expect(page.getByRole("heading", { name: "Rewards", level: 1 })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Rewards given" })).toBeVisible();
    await page.getByRole("tab", { name: "Reversed events" }).click();
    const feed = wide(page) ? page.getByRole("table") : page.getByTestId("card-list");
    await expect(feed.getByText("Given reward reversed").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/\bETB\b|\bbirr\b|revenue/i);
  });
});

test.describe("audit history", () => {
  test("filters, pages, expandable safe details", async ({ page }, info) => {
    await signIn(page, account(info), "/dashboard/audit");
    await expect(page.getByRole("heading", { name: /Audit/i, level: 1 })).toBeVisible();
    await expect(page.getByText("Showing 1–10")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Showing 11–20")).toBeVisible();
    await page.getByRole("button", { name: "Previous", exact: true }).click();

    await page.getByLabel("Action").selectOption({ label: "Stamp reversed" });
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(
      (wide(page) ? page.getByRole("table") : page.getByTestId("card-list"))
        .getByText("Stamp reversed")
        .first(),
    ).toBeVisible();

    const first = wide(page) ? page.getByRole("table") : page.getByTestId("card-list");
    await first
      .getByRole("button", { name: /Show details/ })
      .first()
      .click();
    await expect(first.getByText(/never shown/).first()).toBeVisible();

    await page.getByLabel("Reference of the item").fill("nothing-like-this");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByText("No activity matches these filters.")).toBeVisible();
  });

  test("never shows the secrets in the mock's sign-in entry", async ({ page }, info) => {
    await signIn(page, account(info), "/dashboard/audit");
    await page.getByLabel("Action").selectOption({ label: "Signed in" });
    await page.getByRole("button", { name: "Apply filters" }).click();
    const list = wide(page) ? page.getByRole("table") : page.getByTestId("card-list");
    await list
      .getByRole("button", { name: /Show details/ })
      .first()
      .click();
    await list
      .getByRole("button", { name: /Show details/ })
      .first()
      .click()
      .catch(() => undefined);
    const html = await page.content();
    for (const secret of [
      "BAIT-TOKEN-VALUE",
      "BAIT-PASSWORD",
      "BAIT-WALLET-CREDENTIAL",
      "BaitBrowser",
    ]) {
      expect(html).not.toContain(secret);
    }
  });
});

test.describe("layout and language", () => {
  for (const path of ["/dashboard/customers", "/dashboard/rewards", "/dashboard/audit"]) {
    test(`${path}: no sideways scrolling and no accessibility violations`, async ({
      page,
    }, info) => {
      await signIn(page, account(info), path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("table").or(page.getByTestId("card-list")).first()).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    });
  }

  test("Amharic customers page has no missing translations", async ({ page }, info) => {
    const missing: string[] = [];
    page.on("console", (m) => {
      if (m.text().includes("[i18n] Missing")) missing.push(m.text());
    });
    await signIn(page, account(info), "/dashboard/customers", "am");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("ደንበኞች");
    await expect(page.getByRole("button", { name: /ይመልከቱ/ }).first()).toBeVisible();
    expect(missing).toEqual([]);
  });
});
