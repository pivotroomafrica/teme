import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Settings, fraud monitoring, privacy tools, customer care and campaigns in a real browser against the mock backend.
 * The phone project signs in as the manager and the desktop project as the owner, each with its own data. Owners can
 * change things, managers can only look, so the tests check both sides.
 */
test.describe.configure({ mode: "serial" });

const owner = (info: TestInfo) => !info.project.name.includes("mobile");

async function signIn(page: Page, email: string, path: string, locale = "en") {
  await page.goto(`/${locale}/login`);
  await page.locator('form[data-hydrated="true"]').waitFor();
  await page.getByLabel(/^(Email address|የኢሜይል አድራሻ)/).fill(email);
  await page.getByLabel(/^(Password|የይለፍ ቃል)/).fill("mock-password-1");
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/\/(dashboard|staff\/branch|operations)$/);
  await page.goto(`/${locale}${path}`);
}
const account = (info: TestInfo) => (owner(info) ? "owner@mock.test" : "manager@mock.test");
const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 768;
const list = (page: Page) => (wide(page) ? page.getByRole("table") : page.getByTestId("card-list"));

test.describe("settings", () => {
  test("shows the business, saves a change, and explains the logo", async ({ page }, info) => {
    await signIn(page, account(info), "/dashboard/settings");
    const name = page.getByLabel(/^Business name \(English\)/);
    await expect(name).toHaveValue("Sample Cafe");
    await expect(page.getByText(/Logos cannot be uploaded yet/)).toBeVisible();
    await name.fill(owner(info) ? "Sample Cafe Bole" : "Sample Cafe Piassa");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Settings saved")).toBeVisible();
    await expect(page.getByLabel(/^Business name \(English\)/)).toHaveValue(
      owner(info) ? "Sample Cafe Bole" : "Sample Cafe Piassa",
    );
  });
});

test.describe("fraud monitoring", () => {
  test("lists flags; only an owner can review them or change the limits", async ({
    page,
  }, info) => {
    await signIn(page, account(info), "/dashboard/fraud");
    await expect(
      page.getByText(/Nothing is blocked, suspended or reported automatically/),
    ).toBeVisible();
    await expect(list(page).first()).toBeVisible();
    if (owner(info)) {
      await list(page)
        .getByRole("button", { name: /Review/ })
        .first()
        .click();
      const dialog = page.getByRole("dialog", { name: "Review this flag" });
      await dialog.getByLabel("Your verdict").selectOption({ label: "False alarm" });
      await dialog.getByRole("button", { name: "Record verdict" }).click();
      await expect(page.getByText("Verdict recorded")).toBeVisible();
      await page.getByRole("tab", { name: "Limits" }).click();
      const field = page.getByLabel(/^Most stamps/);
      await field.fill("55");
      await page.getByRole("button", { name: "Save limits" }).click();
      await expect(page.getByText("Limits saved")).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: /^Review/ })).toHaveCount(0);
      await page.getByRole("tab", { name: "Limits" }).click();
      await expect(page.getByLabel(/^Most stamps/)).toBeDisabled();
    }
  });
});

test.describe("privacy and customer care", () => {
  test("the retention page is for owners; a manager is turned away", async ({ page }, info) => {
    await signIn(page, account(info), "/dashboard/privacy");
    if (owner(info)) {
      await expect(page.getByRole("heading", { name: "Privacy and data", level: 1 })).toBeVisible();
      await expect(page.getByLabel(/^Months without activity/)).toHaveValue("36");
      await expect(page.getByText(/refer to people only by an internal number/)).toBeVisible();
    } else {
      await expect(page).toHaveURL(/\/en\/denied$/);
    }
  });

  test("a customer's card can be paused and resumed, and owners see the privacy tools", async ({
    page,
  }, info) => {
    await signIn(page, account(info), "/dashboard/customers");
    await list(page)
      .getByRole("button", { name: /View.*Abebe/ })
      .first()
      .click();
    const detail = page.getByTestId("customer-detail");
    await expect(detail.getByText("Free coffee")).toBeVisible();
    await expect(detail.getByRole("button", { name: "View stored data" })).toHaveCount(
      owner(info) ? 1 : 0,
    );

    await detail.getByRole("button", { name: "Pause this card" }).click();
    await page
      .getByRole("dialog", { name: "Pause this card?" })
      .getByRole("button", { name: "Confirm" })
      .click();
    await expect(page.getByText("Card paused")).toBeVisible();
    await expect(detail.getByRole("button", { name: "Resume this card" })).toBeVisible();
    // The panel stays open: closing the confirmation must not close the panel behind it.
    await expect(detail).toBeVisible();
    await detail.getByRole("button", { name: "Resume this card" }).click();
    await page
      .getByRole("dialog", { name: "Resume this card?" })
      .getByRole("button", { name: "Confirm" })
      .click();
    await expect(page.getByText("Card resumed")).toBeVisible();
  });

  test("an owner can look at the stored data of a customer", async ({ page }, info) => {
    test.skip(!owner(info), "privacy tools are for owners");
    await signIn(page, "owner@mock.test", "/dashboard/customers");
    await list(page)
      .getByRole("button", { name: /View.*Tigist/ })
      .first()
      .click();
    await page
      .getByTestId("customer-detail")
      .getByRole("button", { name: "View stored data" })
      .click();
    const data = page.getByTestId("stored-data");
    await expect(data.getByText("Tigist")).toBeVisible();
  });
});

test.describe("campaigns (preview)", () => {
  test("says it is a preview, makes a draft and sends it after a confirmation", async ({
    page,
  }, info) => {
    await signIn(page, account(info), "/dashboard/campaigns");
    await expect(page.getByText("Preview only")).toBeVisible();
    await expect(page.getByText(/Nothing is sent to any customer/)).toBeVisible();
    await page.getByRole("button", { name: "New campaign" }).click();
    const dialog = page.getByRole("dialog", { name: "New campaign" });
    await dialog.getByLabel(/^Name/).fill("Autumn offer");
    await dialog.getByLabel(/^Message \(English\)/).fill("Come in this week.");
    await dialog.getByRole("button", { name: "Save as draft" }).click();
    await expect(page.getByText("Draft saved")).toBeVisible();
    await list(page).getByRole("button", { name: /^Send/ }).first().click();
    const confirm = page.getByRole("dialog", { name: "Send this campaign?" });
    await expect(confirm.getByText(/will go to \d+ customer/)).toBeVisible();
    await confirm.getByRole("button", { name: "Send now" }).click();
    await expect(page.getByText("Campaign sent")).toBeVisible();
  });
});

test.describe("language", () => {
  test("the new pages work in Amharic with no missing translations", async ({ page }, info) => {
    const missing: string[] = [];
    page.on("console", (m) => {
      if (m.text().includes("[i18n] Missing")) missing.push(m.text());
    });
    await signIn(page, account(info), "/dashboard/settings", "am");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const path of ["/dashboard/fraud", "/dashboard/campaigns"]) {
      await page.goto(`/am${path}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    expect(missing).toEqual([]);
  });
});
