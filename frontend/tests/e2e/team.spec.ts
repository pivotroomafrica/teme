import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

/**
 * Team and branch management in a real browser against the mock backend, whose rules mirror the real backend's.
 * Each mock account has its own copy of the data: the phone project signs in as the manager and the desktop
 * project as the owner, so they never collide. Changes are made to people and branches the tests create
 * themselves (the seeded ones are only read, or put back), and everything runs one test after another.
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

/** One person's (or branch's) row on a wide screen, or card on a phone: whichever layout is showing. */
const entry = (page: Page, name: RegExp | string): Locator =>
  wide(page)
    ? page.getByRole("table").getByRole("row", { name })
    : page.getByTestId("card-list").getByRole("listitem").filter({ hasText: name });

const search = (page: Page, label: string, text: string) =>
  page.getByRole("searchbox", { name: label }).fill(text);

async function openMenu(page: Page, name: RegExp | string) {
  await entry(page, name)
    .getByRole("button", { name: /Actions for/ })
    .click();
}
const menuItem = (page: Page, name: string) => page.getByRole("menuitem", { name });
const dialog = (page: Page, name?: string | RegExp) =>
  page.getByRole("dialog", name ? { name } : {});

async function waitTeam(page: Page) {
  await expect(entry(page, /Selam Cashier|Hana Owner/).first()).toBeVisible();
}

async function invite(page: Page, name: string, email: string, role = "Branch staff") {
  await page.getByRole("button", { name: "Invite someone" }).click();
  const d = dialog(page, "Invite a team member");
  await d.getByRole("textbox", { name: /Email address/ }).fill(email);
  await d.getByRole("textbox", { name: /^Name/ }).fill(name);
  await d.getByRole("combobox", { name: /Role/ }).selectOption({ label: role });
  if (role === "Branch staff")
    await d.locator("label", { hasText: "Bole" }).click(); /* the label is the tap target */
  await d.getByRole("button", { name: "Create invitation" }).click();
}

test.describe("the team", () => {
  test("lists people 10 at a time with roles, statuses and branches, and shows no credentials", async ({
    page,
  }, info) => {
    await signIn(page, account(info), "/dashboard/team");
    await waitTeam(page);
    await expect(page.getByText(/Showing 1–10 of \d+/)).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText(/Showing 11–\d+ of \d+/)).toBeVisible();
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/password|hash|secret|user agent|ip address/i);
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await search(page, "Search by name or email", "Selam");
    await expect(entry(page, /Selam Cashier/)).toContainText("Bole, Piassa");
  });

  test("the whole life of an invitation: invite, one-time code, change role and branches, new code, deactivate, activate", async ({
    page,
  }, info) => {
    test.setTimeout(120_000); // a long story, told through the real screens
    const stamp = Date.now() % 100000;
    const name = `Tester ${stamp}`;
    await signIn(page, account(info), "/dashboard/team");
    await waitTeam(page);

    // A form that is checked before anything is sent.
    await page.getByRole("button", { name: "Invite someone" }).click();
    await dialog(page, "Invite a team member")
      .getByRole("button", { name: "Create invitation" })
      .click();
    await expect(dialog(page).getByText("Enter a valid email address.")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toHaveCount(0);

    await invite(page, name, `tester${stamp}@mock.test`);
    const token = dialog(page, `Invitation for ${name}`);
    await expect(token).toContainText("No email is sent");
    const code = await token.getByRole("textbox", { name: "Invitation code" }).inputValue();
    expect(code.length).toBeGreaterThan(16);
    await token.getByRole("button", { name: "I have given it" }).click();
    expect(await page.content()).not.toContain(code); // shown once, then gone

    await search(page, "Search by name or email", name);
    await expect(entry(page, name)).toContainText("Invitation pending");

    // Role
    await openMenu(page, name);
    await menuItem(page, "Change role").click();
    const role = dialog(page, `Change the role of ${name}`);
    if (account(info) === "owner@mock.test") {
      await role.getByRole("combobox", { name: "Role" }).selectOption({ label: "Manager" });
      await role.getByRole("button", { name: "Change role" }).click();
      await expect(page.getByText("Role changed.")).toBeVisible();
      await expect(entry(page, name)).toContainText("Manager");
    } else {
      // A manager can only hand out the branch staff role, so there is nothing higher to choose.
      await expect(role.getByRole("combobox", { name: "Role" }).getByRole("option")).toHaveText([
        "Branch staff",
      ]);
      await role.getByRole("button", { name: "Cancel" }).click();
    }

    // Branches
    await openMenu(page, name);
    await menuItem(page, "Change branches").click();
    const branches = dialog(page, `Branches for ${name}`);
    await branches.locator("label", { hasText: "Piassa" }).click();
    await branches.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Branches updated.")).toBeVisible();
    await expect(entry(page, name)).toContainText("Piassa");

    // A new invitation code; the old one stops working.
    await openMenu(page, name);
    await menuItem(page, "New invitation code").click();
    await dialog(page).getByRole("button", { name: "New invitation code" }).click();
    const again = dialog(page, `Invitation for ${name}`);
    const newCode = await again.getByRole("textbox", { name: "Invitation code" }).inputValue();
    expect(newCode).not.toBe(code);
    await again.getByRole("button", { name: "I have given it" }).click();

    // Deactivate, then activate.
    await openMenu(page, name);
    await menuItem(page, "Deactivate").click();
    await expect(dialog(page)).toContainText("Their history is kept");
    await dialog(page).getByRole("button", { name: "Deactivate" }).click();
    await expect(entry(page, name)).toContainText("Deactivated");
    await openMenu(page, name);
    await expect(menuItem(page, "Change role")).toHaveAttribute("aria-disabled", "true"); // a deactivated member cannot be changed
    await menuItem(page, "Activate").click();
    await dialog(page).getByRole("button", { name: "Activate" }).click();
    await expect(entry(page, name)).not.toContainText("Deactivated");
  });

  test("an address that is already used gets the same careful answer, with no code", async ({
    page,
  }, info) => {
    await signIn(page, account(info), "/dashboard/team");
    await waitTeam(page);
    await invite(page, "Copy Cat", "staff@mock.test");
    await expect(dialog(page, "Invite a team member")).toContainText(
      "This person cannot be invited",
    );
    await expect(page.getByTestId("invitation-token")).toHaveCount(0);
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
  });

  test("the signed-in person is marked and cannot change themselves", async ({ page }, info) => {
    await signIn(page, account(info), "/dashboard/team");
    await waitTeam(page);
    const me = account(info) === "owner@mock.test" ? /Hana Owner/ : /Dawit Manager/;
    await search(
      page,
      "Search by name or email",
      account(info).split("@")[0]!.replace("owner", "Hana").replace("manager", "Dawit"),
    );
    await expect(entry(page, me).getByText("You", { exact: true })).toBeVisible();
    await openMenu(page, me);
    for (const item of ["Change role", "Change branches", "Deactivate"]) {
      await expect(menuItem(page, item)).toHaveAttribute("aria-disabled", "true");
    }
  });

  test("filters by status and role and says when nobody matches", async ({ page }, info) => {
    await signIn(page, account(info), "/dashboard/team");
    await waitTeam(page);
    await page.getByRole("combobox", { name: "Status" }).selectOption("DEACTIVATED");
    await expect(entry(page, /Former Cashier/)).toBeVisible();
    await page.getByRole("combobox", { name: "Role" }).selectOption("OWNER");
    await expect(page.getByTestId("no-match")).toContainText("Nobody matches");
  });

  test("shows recent activity with counts and loads more on request", async ({ page }, info) => {
    await signIn(page, account(info), "/dashboard/team");
    await waitTeam(page);
    await search(page, "Search by name or email", "Selam");
    await openMenu(page, /Selam Cashier/);
    await menuItem(page, "Recent activity").click();
    const d = dialog(page, "Recent activity: Selam Cashier");
    await expect(d.getByTestId("activity")).toContainText("Stamps issued");
    await expect(d.getByTestId("activity-events").getByRole("listitem")).toHaveCount(10);
    await d.getByRole("button", { name: "Show more" }).click();
    await expect(d.getByTestId("activity-events").getByRole("listitem")).toHaveCount(20);
    await expect(d).not.toContainText(/user agent|ip address/i);
  });
});

test.describe("who may do what", () => {
  test("a manager can manage branch staff only", async ({ page }) => {
    await signIn(page, "manager@mock.test", "/dashboard/team");
    await waitTeam(page);
    await expect(page.getByText("As a manager you can manage branch staff only.")).toBeVisible();
    await search(page, "Search by name or email", "Hana");
    await openMenu(page, /Hana Owner/);
    await expect(menuItem(page, "Deactivate")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Invite someone" }).click();
    const roles = dialog(page).getByRole("combobox", { name: /Role/ });
    await expect(roles.getByRole("option")).toHaveText(["Branch staff"]);
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
  });

  test("branch staff are turned away from both pages", async ({ page }) => {
    await signIn(page, "staff@mock.test", "/dashboard/team");
    await expect(page).toHaveURL(/\/en\/(denied|staff\/branch|staff\/scanner)/);
    await page.goto("/en/dashboard/branches");
    await expect(page).toHaveURL(/\/en\/(denied|staff\/branch|staff\/scanner)/);
  });

  test("a read-only account can look at the team and branches but change nothing", async ({
    page,
  }) => {
    await signIn(page, "viewer@mock.test", "/dashboard/team");
    await waitTeam(page);
    await expect(page.getByText("You can see the team but not change it.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Invite someone" })).toHaveCount(0);
    await search(page, "Search by name or email", "Selam");
    await openMenu(page, /Selam Cashier/);
    await expect(page.getByRole("menuitem")).toHaveText(["Recent activity"]);
    await page.keyboard.press("Escape");

    await page.goto("/en/dashboard/branches");
    await expect(page.getByText("You can look at the branches but not change them.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add branch" })).toHaveCount(0);
  });
});

test.describe("branches", () => {
  test("adds, edits, deactivates and reactivates a branch, and protects the last active one", async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const stamp = Date.now() % 100000;
    const name = `Branch ${stamp}`;
    await signIn(page, account(info), "/dashboard/branches");
    await expect(entry(page, /Bole/).first()).toBeVisible();

    await page.getByRole("button", { name: "Add branch" }).click();
    const form = dialog(page, "Add a branch");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByText("Enter a name.")).toBeVisible();
    await form.getByRole("textbox", { name: /^Branch name \(English\)/ }).fill(name);
    await form.getByRole("textbox", { name: /^Phone number/ }).fill("12345");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByText(/valid Ethiopian phone number/)).toBeVisible();
    await form.getByRole("textbox", { name: /^Phone number/ }).fill("0911 234 567");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Branch added.")).toBeVisible();
    await search(page, "Search by name or city", name);
    await expect(entry(page, name)).toContainText("+251911234567");

    // Edit: only the city changes.
    const bodies: unknown[] = [];
    page.on("request", (r) => {
      if (r.method() === "PATCH" && r.url().includes("/merchant/branches/"))
        bodies.push(r.postDataJSON());
    });
    await openMenu(page, name);
    await menuItem(page, "Edit").click();
    await dialog(page, `Edit ${name}`).getByRole("textbox", { name: /^City/ }).fill("Hawassa");
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(entry(page, name)).toContainText("Hawassa");
    expect(bodies).toEqual([{ city: "Hawassa" }]);

    // Deactivate and activate it again.
    await openMenu(page, name);
    await menuItem(page, "Deactivate").click();
    await expect(dialog(page)).toContainText("can no longer scan or give rewards at this branch");
    await dialog(page).getByRole("button", { name: "Deactivate" }).click();
    await expect(entry(page, name)).toContainText("Not active");
    await openMenu(page, name);
    await menuItem(page, "Activate").click();
    await dialog(page).getByRole("button", { name: "Activate" }).click();
    await expect(entry(page, name)).not.toContainText("Not active");

    // The last active branch cannot be deactivated: the backend says so. Make Bole the only active one first.
    await search(page, "Search by name or city", "");
    for (const other of [name, "Piassa"]) {
      await search(page, "Search by name or city", other);
      await openMenu(page, other);
      await menuItem(page, "Deactivate").click();
      await dialog(page).getByRole("button", { name: "Deactivate" }).click();
      await expect(entry(page, other)).toContainText("Not active");
    }
    await search(page, "Search by name or city", "Bole");
    await openMenu(page, /Bole/);
    await menuItem(page, "Deactivate").click();
    await dialog(page).getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByText(/A business must keep at least one active branch/)).toBeVisible();
    await expect(entry(page, /Bole/)).not.toContainText("Not active");

    // Put Piassa back, as the seed has it.
    await search(page, "Search by name or city", "Piassa");
    await openMenu(page, /Piassa/);
    await menuItem(page, "Activate").click();
    await dialog(page).getByRole("button", { name: "Activate" }).click();
    await expect(entry(page, /Piassa/)).not.toContainText("Not active");
  });

  test("shows who works at a branch", async ({ page }, info) => {
    await signIn(page, account(info), "/dashboard/branches");
    await expect(entry(page, /Piassa/).first()).toBeVisible();
    await search(page, "Search by name or city", "Piassa");
    await openMenu(page, /Piassa/);
    await menuItem(page, "Team here").click();
    const d = dialog(page, "Team at Piassa");
    await expect(d.getByTestId("branch-team")).toContainText("Selam Cashier");
    await expect(d.getByTestId("branch-team")).not.toContainText("Former Cashier");
    await expect(d).toContainText("Owners and managers can work at every branch.");
  });
});

test.describe("layout, language and accessibility", () => {
  test("a table on wide screens and labelled cards on phones, never both", async ({
    page,
  }, info) => {
    await signIn(page, account(info), "/dashboard/team");
    await waitTeam(page);
    if (wide(page)) {
      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.getByTestId("card-list")).toBeHidden();
    } else {
      await expect(page.getByRole("table")).toBeHidden();
      const card = page.getByTestId("card-list").getByRole("listitem").first();
      await expect(card).toContainText("Email");
      await expect(card).toContainText("Role");
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("works in Amharic", async ({ page }, info) => {
    await signIn(page, account(info), "/dashboard/team", "am");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ቡድን");
    await expect(page.getByRole("button", { name: "ሰው ይጋብዙ" })).toBeVisible();
    await page.goto("/am/dashboard/branches");
    await expect(page.getByRole("button", { name: "ቅርንጫፍ ጨምር" })).toBeVisible();
  });

  test("has no accessibility violations: team, invite dialog and branches", async ({
    page,
  }, info) => {
    await signIn(page, account(info), "/dashboard/team");
    await waitTeam(page);
    const check = async (label: string) => {
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations.map((v) => `${label} ${v.id}: ${v.help}`)).toEqual([]);
    };
    await check("team");
    await page.getByRole("button", { name: "Invite someone" }).click();
    await expect(dialog(page, "Invite a team member")).toBeVisible();
    await check("invite");
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await page.goto("/en/dashboard/branches");
    await expect(entry(page, /Bole/).first()).toBeVisible();
    await check("branches");
  });
});
