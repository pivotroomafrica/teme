import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Phone numbers are remembered by the mock backend while the server runs, so every test uses its own.
let counter = 0;
function freshPhone(): string {
  counter += 1;
  const tail = String(Math.floor(Math.random() * 9000) + 1000);
  return `09${String(counter).padStart(3, "0")}${tail}1`;
}

async function open(page: Page, path = "/en/join/sample-cafe") {
  await page.goto(path);
  await expect(page.locator('form[data-hydrated="true"]')).toBeVisible();
}

// The whole row is the tap target (a label stretched over the box), so people - and tests - click the words.
const TERMS = /^(I agree to the terms|በዚህ የታማኝነት ፕሮግራም)/;
const MARKETING = /^(Send me offers|ቅናሾችንና ዜናዎችን)/;

async function fillForm(page: Page, phone = freshPhone(), name = "Abebe") {
  await page.getByLabel(/^(First name|የመጀመሪያ ስም)/).fill(name);
  await page.getByLabel(/^(Phone number|ስልክ ቁጥር)/).fill(phone);
  await page.getByText(TERMS).click();
}

test.describe("join page", () => {
  test("shows who the customer is joining, the reward and the terms", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome to Sample Cafe");
    await expect(page.getByText("Free coffee", { exact: true })).toBeVisible();
    await expect(page.getByText("Collect 8 stamps to earn")).toBeVisible();
    await page.getByText("Read the terms").click();
    await expect(
      page.getByText("One stamp per visit. The 8th stamp earns a free coffee."),
    ).toBeVisible();
  });

  test("shows the business's own Amharic wording on the Amharic page, untouched", async ({
    page,
  }) => {
    await open(page, "/am/join/sample-cafe");
    await expect(page.getByText("ነጻ ቡና", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("ናሙና ቡና ቤት");
  });

  test("never shows internal identifiers", async ({ page }) => {
    await open(page);
    const html = await page.content();
    expect(html).not.toMatch(/merchantId|programId|membershipId|"id":"/i);
  });

  test("has no accessibility violations and does not scroll sideways", async ({ page }) => {
    await open(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("validation", () => {
  test("explains each problem and sends nothing", async ({ page }) => {
    let sent = 0;
    await page.route("**/api/bff/join/*/enroll", (route) => {
      sent += 1;
      return route.continue();
    });
    await open(page);
    await page.getByRole("button", { name: "Get my card" }).click();
    await expect(page.getByText("Enter your first name.")).toBeVisible();
    await expect(page.getByText("Enter your phone number.")).toBeVisible();
    await expect(page.getByText("You need to agree to the terms to join.")).toBeVisible();

    await page.getByLabel(/^First name/).fill("Abebe");
    await page.getByLabel(/^Phone number/).fill("0611234567");
    await page.getByText(TERMS).click();
    await page.getByRole("button", { name: "Get my card" }).click();
    await expect(page.getByText("Enter a valid Ethiopian phone number.")).toBeVisible();
    expect(sent).toBe(0);
  });

  test("shows the messages in Amharic", async ({ page }) => {
    await open(page, "/am/join/sample-cafe");
    await page.getByRole("button", { name: "ካርዴን አግኝ" }).click();
    await expect(page.getByText("የመጀመሪያ ስምዎን ያስገቡ።")).toBeVisible();
  });
});

test.describe("enrolling", () => {
  test("creates a card, records the choices made and offers the wallets", async ({ page }) => {
    const bodies: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/enroll")) {
        bodies.push(request.postDataJSON() as Record<string, unknown>);
      }
    });
    await open(page);
    await fillForm(page);
    await page.getByRole("button", { name: "Get my card" }).click();

    await expect(page.getByRole("heading", { name: "Your card is ready" })).toBeVisible();
    // Only the wallet that suits this phone is offered (both on a desktop); none is set up in the mock, so
    // every wallet button shown is disabled and says so.
    const wallets = page.getByRole("button", { name: /^Add to (Apple|Google) Wallet$/ });
    await expect(wallets.first()).toBeDisabled();
    for (const wallet of await wallets.all()) await expect(wallet).toBeDisabled();
    await expect(page.getByText("Not available on this device").first()).toBeVisible();
    const href = await page.getByRole("link", { name: "Open my web card" }).getAttribute("href");
    // The card is already saved on the phone, so the link names it by an opaque id, never by its token.
    expect(href).toMatch(/^\/en\/card\?c=[\w-]+$/);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      firstName: "Abebe",
      preferredLanguage: "EN",
      acceptTerms: true,
      marketingConsent: false,
      consentVersion: expect.any(String),
    });
    expect(String(bodies[0]!.phone)).toMatch(/^\+251\d{9}$/);
  });

  test("records Amharic as the customer's language and the marketing opt-in", async ({ page }) => {
    const bodies: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/enroll")) {
        bodies.push(request.postDataJSON() as Record<string, unknown>);
      }
    });
    await open(page, "/am/join/sample-cafe");
    await fillForm(page, freshPhone(), "አበበ");
    await page.getByText(MARKETING).click();
    await page.getByRole("button", { name: "ካርዴን አግኝ" }).click();
    await expect(page.getByRole("heading", { name: "ካርድዎ ዝግጁ ነው" })).toBeVisible();
    expect(bodies[0]).toMatchObject({ preferredLanguage: "AM", marketingConsent: true });
  });

  test("welcomes an existing member without handing over a card", async ({ page }) => {
    await open(page);
    await fillForm(page, "0911230000");
    await page.getByRole("button", { name: "Get my card" }).click();
    await expect(page.getByRole("heading", { name: "You are already a member" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open my web card" })).toHaveCount(0);
  });

  test("the same number joining twice becomes an existing member the second time", async ({
    page,
  }) => {
    const phone = freshPhone();
    await open(page);
    await fillForm(page, phone);
    await page.getByRole("button", { name: "Get my card" }).click();
    await expect(page.getByRole("heading", { name: "Your card is ready" })).toBeVisible();

    await open(page);
    await fillForm(page, phone);
    await page.getByRole("button", { name: "Get my card" }).click();
    await expect(page.getByRole("heading", { name: "You are already a member" })).toBeVisible();
  });

  test("sends one request when the button is pressed repeatedly", async ({ page }) => {
    let sent = 0;
    await page.route("**/api/bff/join/*/enroll", async (route) => {
      sent += 1;
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    await open(page);
    await fillForm(page);
    const button = page.getByRole("button", { name: "Get my card" });
    await button.dblclick();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Your card is ready" })).toBeVisible();
    expect(sent).toBe(1);
  });

  test("keeps the details after a network failure and succeeds on retry", async ({ page }) => {
    await open(page);
    await fillForm(page, freshPhone(), "Selam");
    await page.route("**/api/bff/join/*/enroll", (route) => route.abort("connectionreset"));
    await page.getByRole("button", { name: "Get my card" }).click();

    await expect(
      page.locator("main [role=alert]").filter({ hasText: /reach the server/ }),
    ).toBeVisible();
    await expect(page.getByText(/could not confirm that your card was created/)).toBeVisible();
    await expect(page.getByLabel(/^First name/)).toHaveValue("Selam");
    await expect(page.getByRole("checkbox", { name: TERMS })).toBeChecked();

    await page.unroute("**/api/bff/join/*/enroll");
    await page.getByRole("button", { name: "Get my card" }).click();
    await expect(page.getByRole("heading", { name: "Your card is ready" })).toBeVisible();
  });
});

test.describe("links that cannot be joined", () => {
  for (const [path, label] of [
    ["/en/join/not-a-real-link", "an unknown link"],
    [
      "/en/join/paused-program",
      "a paused, archived or expired program (indistinguishable by design)",
    ],
    ["/en/join/..%2F..%2Fetc", "a malformed reference"],
  ] as const) {
    test(`explains ${label}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "This join link is not available",
      );
      await expect(page.getByRole("link", { name: "Go to the home page" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Get my card" })).toHaveCount(0);
    });
  }

  test("explains it in Amharic", async ({ page }) => {
    await page.goto("/am/join/not-a-real-link");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ይህ የመቀላቀያ አገናኝ አይገኝም");
  });

  test("offers a retry when the service is busy or down, and nothing was sent", async ({
    page,
  }) => {
    await page.goto("/en/join/busy");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("We could not load this page");
    await expect(page.locator("main [role=alert]")).toContainText("Too many attempts");
    await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/en/join/busy",
    );

    await page.goto("/en/join/down");
    await expect(page.locator("main [role=alert]")).toContainText("temporarily unavailable");
  });
});
