import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * The program builder in a real browser against the mock backend. Every mock account has its own programs (see
 * src/mocks/program-data.ts), so the phone project signs in as the manager and the desktop project as the owner:
 * they never touch each other's data. Within a file the tests run one after another and leave the seeded
 * program as they found it (active, 12 members).
 */
test.describe.configure({ mode: "serial" });

const account = (info: TestInfo) =>
  info.project.name.includes("mobile") ? "manager@mock.test" : "owner@mock.test";

async function openProgram(page: Page, email: string, locale = "en") {
  await page.goto(`/${locale}/login`);
  await page.locator('form[data-hydrated="true"]').waitFor();
  await page.getByLabel(/^(Email address|የኢሜይል አድራሻ)/).fill(email);
  await page.getByLabel(/^(Password|የይለፍ ቃል)/).fill("mock-password-1");
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(new RegExp(`/${locale}/dashboard$`));
  await page.goto(`/${locale}/dashboard/program`);
  await ready(page);
}

async function ready(page: Page) {
  await page.locator('div[data-hydrated="true"]:has(form[data-testid="program-form"])').waitFor();
}

const nameField = (page: Page) => page.getByRole("textbox", { name: /^Program name \(English\)/ });
const rewardField = (page: Page) => page.getByRole("textbox", { name: /^Reward \(English\)/ });
const programPicker = (page: Page) => page.getByRole("combobox", { name: "Program" });
const confirm = (page: Page, name: string | RegExp) =>
  page.getByRole("dialog").getByRole("button", { name });

async function chooseProgram(page: Page, label: RegExp) {
  const option = programPicker(page).locator("option", { hasText: label });
  await programPicker(page).selectOption({ label: (await option.first().textContent())! });
  await ready(page);
}

async function createDraft(page: Page, name: string) {
  await page.getByRole("button", { name: "New program" }).click();
  await ready(page);
  await nameField(page).fill(name);
  await rewardField(page).fill("Free tea");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

test("shows the live program with its status, members and a locked stamp count", async ({
  page,
}, info) => {
  await openProgram(page, account(info));
  await expect(page.getByRole("heading", { name: "Coffee Card", level: 2 })).toBeVisible();
  await expect(page.getByText("Active: new customers can join.")).toBeVisible();
  await expect(page.getByText("12 members")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Stamps needed/ })).toBeDisabled();
  await expect(page.getByText(/because 12 customers have joined/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
});

test("previews follow typing before anything is saved", async ({ page }, info) => {
  await openProgram(page, account(info));
  const previews = page.getByTestId("previews");
  await expect(previews.getByTestId("preview-draft")).toHaveCount(0);

  await nameField(page).fill("Preview Only Name");
  await expect(previews.getByTestId("preview-draft")).toBeVisible();
  await expect(page.getByTestId("preview-join")).toContainText("Preview Only Name");
  await previews.getByRole("tab", { name: "Web card" }).click();
  await expect(page.getByTestId("preview-web")).toContainText("Preview Only Name");

  await previews.getByRole("tab", { name: "Wallet card" }).click();
  await page.getByRole("textbox", { name: /^Card title/ }).fill("Wallet Title");
  await expect(page.getByTestId("preview-wallet")).toContainText("Wallet Title");
  await expect(page.getByTestId("wallet-progress-text")).toContainText("3 of 8 stamps");
  await page.getByText(/Show the stamp count/).click(); // the whole row is the tap target
  await expect(page.getByTestId("wallet-progress-text")).toHaveCount(0);

  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(nameField(page)).toHaveValue("Coffee Card");
});

test("shows the backend's limits as instant messages and sends nothing when invalid", async ({
  page,
}, info) => {
  let patches = 0;
  await page.route("**/api/bff/merchant/programs/*", (route) => {
    if (route.request().method() === "PATCH") patches += 1;
    return route.continue();
  });
  await openProgram(page, account(info));
  await nameField(page).fill("");
  await page.getByRole("textbox", { name: /^Minutes between stamps/ }).fill("99999");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Enter a name.")).toBeVisible();
  await expect(page.getByText("Enter a whole number from 0 to 10,080.")).toBeVisible();
  expect(patches).toBe(0);
  await page.getByRole("button", { name: "Discard changes" }).click();
});

test("a change members will see asks first and sends only that field", async ({ page }, info) => {
  const bodies: unknown[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes("/merchant/programs/"))
      bodies.push(r.postDataJSON());
  });
  await openProgram(page, account(info));
  await page.getByRole("textbox", { name: /^Program name \(Amharic\)/ }).fill("የቡና ካርድ 2");
  await page.getByRole("button", { name: "Save changes" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("These changes reach 12 members");
  await expect(dialog).toContainText("What changes: name");
  expect(bodies).toHaveLength(0);
  await confirm(page, "Save and update cards").click();
  await expect(page.getByText("Saved.")).toBeVisible();
  expect(bodies).toEqual([{ nameAm: "የቡና ካርድ 2" }]);

  // Put it back, so the next test finds the program as seeded.
  await page.getByRole("textbox", { name: /^Program name \(Amharic\)/ }).fill("የቡና ካርድ");
  await page.getByRole("button", { name: "Save changes" }).click();
  await confirm(page, "Save and update cards").click();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
});

test("creates a draft, saves an edit, and finds it again after a reload", async ({
  page,
}, info) => {
  const name = `Spring ${Date.now() % 100000}`;
  await openProgram(page, account(info));
  await createDraft(page, name);
  await expect(page.getByText("Draft: customers cannot join yet.")).toBeVisible();
  await expect(page.getByText("No members yet")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Stamps needed/ })).toBeEnabled(); // not locked: nobody has joined

  await page.getByRole("textbox", { name: /^Minutes between stamps/ }).fill("30");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0); // no member, so no warning

  await page.reload();
  await ready(page);
  await chooseProgram(page, new RegExp(name));
  await expect(page.getByRole("textbox", { name: /^Minutes between stamps/ })).toHaveValue("30");

  await page.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("ARCHIVE");
  await confirm(page, "Archive").click();
  await expect(page.getByText(/archived and cannot be changed/)).toBeVisible();
});

test("publishing, pausing, resuming and archiving follow the backend's rules", async ({
  page,
}, info) => {
  const name = `Autumn ${Date.now() % 100000}`;
  await openProgram(page, account(info));
  await createDraft(page, name);

  // Another program is already the active default: the page warns, and the backend refuses.
  await expect(page.getByText(/Another program is active/)).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("dialog")).toContainText("Publish this program?");
  await confirm(page, "Publish").click();
  await expect(page.getByText(/Another program is already the active one/)).toBeVisible();

  // Pause the live one (members keep everything), then publish the draft.
  await chooseProgram(page, /Coffee Card/);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Existing members, stamps and rewards stay as they are",
  );
  await confirm(page, "Pause").click();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await expect(
    page.getByText("Paused: no new customers; members keep their stamps."),
  ).toBeVisible();

  await chooseProgram(page, new RegExp(name));
  await page.getByRole("button", { name: "Publish" }).click();
  await confirm(page, "Publish").click();
  await expect(page.getByText("Active: new customers can join.")).toBeVisible();

  // And back again: pause the new one, resume the original, archive the new one.
  await page.getByRole("button", { name: "Pause" }).click();
  await confirm(page, "Pause").click();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await chooseProgram(page, /Coffee Card/);
  await page.getByRole("button", { name: "Resume" }).click();
  await confirm(page, "Resume").click();
  await expect(page.getByText("Active: new customers can join.")).toBeVisible();

  await chooseProgram(page, new RegExp(name));
  await page.getByRole("button", { name: "Archive" }).click();
  const dialog = page.getByRole("dialog");
  await expect(confirm(page, "Archive")).toBeDisabled(); // needs the typed word
  await dialog.getByRole("textbox").fill("ARCHIVE");
  await confirm(page, "Archive").click();
  await expect(page.getByText(/archived and cannot be changed/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Save|Publish|Pause|Archive/ })).toHaveCount(0);
});

test("asks before leaving with unsaved changes", async ({ page }, info) => {
  await openProgram(page, account(info));
  await nameField(page).fill("Not saved yet");
  await expect(page.getByText("You have unsaved changes.")).toBeVisible();

  // On a phone the navigation is folded behind a Menu button.
  const menu = page.getByRole("navigation", { name: "Menu" }).getByRole("button", { name: "Menu" });
  if (await menu.isVisible()) await menu.click();

  const messages: string[] = [];
  page.once("dialog", (d) => {
    messages.push(d.message());
    void d.dismiss();
  });
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Team" }).click();
  expect(messages).toEqual(["You have unsaved changes. Leave without saving?"]);
  await expect(page).toHaveURL(/dashboard\/program$/);

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Team" }).click();
  await expect(page).toHaveURL(/dashboard\/team$/);
});

test.describe("join QR and poster", () => {
  test("builds the link from the backend's public reference, in each language", async ({
    page,
  }, info) => {
    await openProgram(page, account(info));
    await page.getByRole("tab", { name: "Join QR and poster" }).click();
    const origin = new URL(page.url()).origin;
    await expect(page.getByTestId("join-link")).toHaveText(`${origin}/join/sample-cafe`);
    await page.getByRole("radio", { name: "English", exact: true }).check();
    await expect(page.getByTestId("join-link")).toHaveText(`${origin}/en/join/sample-cafe`);
    await page.getByRole("radio", { name: "Amharic", exact: true }).check();
    await expect(page.getByTestId("join-link")).toHaveText(`${origin}/am/join/sample-cafe`);
    const html = await page.getByTestId("join-materials").innerHTML();
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  test("offers English, Amharic and bilingual posters", async ({ page }, info) => {
    await openProgram(page, account(info));
    await page.getByRole("tab", { name: "Join QR and poster" }).click();
    const poster = page.getByTestId("poster");
    await page.getByRole("radio", { name: "English", exact: true }).check();
    await expect(poster).toContainText("Join our loyalty program");
    await expect(poster).not.toContainText("ወደ የታማኝነት ፕሮግራማችን ይቀላቀሉ");
    await page.getByRole("radio", { name: "Amharic", exact: true }).check();
    await expect(poster).toContainText("ወደ የታማኝነት ፕሮግራማችን ይቀላቀሉ");
    await page.getByRole("radio", { name: /^English and Amharic/ }).check();
    await expect(poster).toContainText("Join our loyalty program");
    await expect(poster).toContainText("ወደ የታማኝነት ፕሮግራማችን ይቀላቀሉ");
    await expect(page.getByTestId("poster-qr").locator("svg")).toBeVisible();
  });

  test("downloads the code as SVG and PNG", async ({ page }, info) => {
    await openProgram(page, account(info));
    await page.getByRole("tab", { name: "Join QR and poster" }).click();
    await page.getByRole("radio", { name: "English", exact: true }).check();
    const [svg] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download QR (SVG)" }).click(),
    ]);
    expect(svg.suggestedFilename()).toBe("join-qr-en.svg");
    const [png] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download QR (PNG)" }).click(),
    ]);
    expect(png.suggestedFilename()).toBe("join-qr-en.png");
  });

  test("prints only the poster", async ({ page }, info) => {
    await page.addInitScript(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed += 1;
      };
    });
    await openProgram(page, account(info));
    await page.getByRole("tab", { name: "Join QR and poster" }).click();
    await page.getByRole("button", { name: "Print poster or save as PDF" }).click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(
      1,
    );

    await page.emulateMedia({ media: "print" });
    await expect(page.locator("#poster-print")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Menu" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Print poster or save as PDF" })).toBeHidden();
  });

  test("says branch-specific codes are not available", async ({ page }, info) => {
    await openProgram(page, account(info));
    await page.getByRole("tab", { name: "Join QR and poster" }).click();
    await expect(page.getByTestId("branch-qr-unavailable")).toContainText("Not available");
    await expect(page.getByText(/logo cannot be added to posters yet/)).toBeVisible();
  });
});

test("a read-only account can look but not change anything", async ({ page }) => {
  await openProgram(page, "viewer@mock.test");
  await expect(page.getByText(/You can look at this program but not change it/)).toBeVisible();
  await expect(nameField(page)).toBeDisabled();
  for (const name of [/Save/, "Publish", "Pause", "Archive", "New program"]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  }
  // The previews and the QR materials are still there to look at.
  await expect(page.getByTestId("previews")).toBeVisible();
  await page.getByRole("tab", { name: "Join QR and poster" }).click();
  await expect(page.getByTestId("poster")).toBeVisible();
});

test("works in Amharic", async ({ page }, info) => {
  await openProgram(page, account(info), "am");
  await expect(page.getByRole("tab", { name: "ፕሮግራም" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^የፕሮግራም ስም \(እንግሊዝኛ\)/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "ለውጦችን አስቀምጥ" })).toBeVisible();
});

test("has no accessibility violations on either tab and does not scroll sideways", async ({
  page,
}, info) => {
  await openProgram(page, account(info));
  const check = async (label: string) => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations.map((v) => `${label} ${v.id}: ${v.help}`)).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, label).toBeLessThanOrEqual(0);
  };
  await check("program");
  await page.getByRole("tab", { name: "Join QR and poster" }).click();
  await expect(page.getByTestId("poster")).toBeVisible();
  await check("qr");
});
