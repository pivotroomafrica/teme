import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** Puts a card on the phone the way the sign-up page does: the token arrives in the address fragment. */
async function receive(page: Page, token: string, locale = "en") {
  await page.goto(`/${locale}/card#t=${token}`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/card\\?c=`));
}

const card = (page: Page) => page.getByTestId("web-card");

test.describe("receiving and keeping a card", () => {
  test("shows the card, removes the token from the address and keeps the card across visits", async ({
    page,
    context,
  }) => {
    await receive(page, "mock-ok-1-4567");
    await expect(page.getByRole("heading", { level: 1, name: "Sample Cafe" })).toBeVisible();
    await expect(page.getByText("Hello, Abebe")).toBeVisible();
    await expect(page.getByText("Saving your card…")).toHaveCount(0);
    await expect(page.getByRole("img", { name: "2 of 8 stamps" })).toBeVisible();
    await expect(page.getByTestId("card-qr").locator("svg")).toBeVisible();
    expect(page.url()).not.toContain("mock-ok-1-4567");
    expect(page.url()).not.toContain("#");

    // A later visit with no link at all still finds the card.
    await page.goto("/en/card");
    await expect(card(page)).toBeVisible();
    await page.reload();
    await expect(card(page)).toBeVisible();

    // The token is in a sealed HttpOnly cookie and nowhere page scripts can read it.
    const cookie = (await context.cookies()).find((c) => c.name === "tc_card");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(cookie?.value).not.toContain("mock-ok");
    const visible = await page.evaluate(() => ({
      cookie: document.cookie,
      local: JSON.stringify({ ...localStorage }),
      session: JSON.stringify({ ...sessionStorage }),
      text: document.body.innerText,
      html: document.documentElement.outerHTML,
    }));
    for (const where of Object.values(visible)) expect(where).not.toContain("mock-ok-1-4567");
  });

  test("tells a visitor with no card how to get one", async ({ page }) => {
    await page.goto("/en/card");
    await expect(page.getByTestId("card-empty")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("No card on this phone");
  });

  test("refuses a card link that is not real, and keeps nothing", async ({ page, context }) => {
    await page.goto("/en/card#t=this-is-not-a-card");
    await expect(page.getByText("We could not save your card")).toBeVisible();
    await expect(page.getByText("This card link is not valid.")).toBeVisible();
    expect((await context.cookies()).some((c) => c.name === "tc_card")).toBe(false);
    expect(page.url()).not.toContain("this-is-not-a-card");
  });

  test("offers a retry when the service is down while saving", async ({ page, context }) => {
    await page.goto("/en/card#t=mock-down");
    await expect(page.getByText("We could not save your card")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    expect((await context.cookies()).some((c) => c.name === "tc_card")).toBe(false);
  });

  test("keeps a saved card when it cannot be loaded right now, and lets the customer retry", async ({
    page,
  }) => {
    await receive(page, `mock-flaky-${Date.now()}`);
    await expect(card(page)).toBeVisible();
    await page.goto("/en/card");
    await expect(page.getByTestId("card-load-failed")).toBeVisible();
    await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
    await expect(page.getByText(/still saved on this phone/)).toBeVisible();
  });

  test("a second card is added next to the first and can be switched to", async ({ page }) => {
    await receive(page, "mock-ok-1-4567");
    await receive(page, "mock-reward");
    await expect(page.getByTestId("card-reward-ready")).toBeVisible();
    const other = page.getByRole("navigation", { name: "Your cards on this phone" });
    await expect(other).toBeVisible();
    await other.getByRole("link").first().click();
    await expect(page.getByTestId("card-reward-ready")).toHaveCount(0);
    await expect(page.getByRole("img", { name: "2 of 8 stamps" })).toBeVisible();
  });

  test("removing the card from the phone asks first and then shows the empty page", async ({
    page,
  }) => {
    await receive(page, "mock-ok-1-4567");
    await page.getByRole("button", { name: "Remove this card from this phone" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove this card from this phone?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Remove this card from this phone" }).click();
    await expect(page.getByTestId("card-empty")).toBeVisible();
    await page.goto("/en/card");
    await expect(page.getByTestId("card-empty")).toBeVisible();
  });

  test("stopping marketing messages asks first and confirms", async ({ page }) => {
    await receive(page, "mock-ok-1-4567");
    await page.getByRole("button", { name: "Stop marketing messages" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Stop marketing messages?" });
    await dialog.getByRole("button", { name: "Stop marketing messages" }).click();
    await expect(page.getByText("You will no longer get marketing messages.")).toBeVisible();
  });
});

test.describe("card states", () => {
  test("an available reward is unmistakable", async ({ page }) => {
    await receive(page, "mock-reward");
    const banner = page.getByTestId("card-reward-ready");
    await expect(banner).toContainText("A reward is waiting for you");
    await expect(banner).toContainText("Free coffee");
  });

  test("a redeemed reward leaves a completed card and no banner", async ({ page }) => {
    await receive(page, "mock-redeemed");
    await expect(page.getByTestId("card-completed")).toHaveText(
      "You have completed this card once.",
    );
    await expect(page.getByTestId("card-reward-ready")).toHaveCount(0);
    await expect(page.getByRole("img", { name: "0 of 8 stamps" })).toBeVisible();
  });

  for (const [token, title] of [
    ["mock-inactive", "This card is paused"],
    ["mock-invalidated", "This card is no longer valid"],
    ["mock-pending", "Your card is being prepared"],
  ] as const) {
    test(`${token} explains itself and shows no QR code`, async ({ page }) => {
      await receive(page, token);
      await expect(page.getByTestId("card-inactive")).toContainText(title);
      await expect(page.getByTestId("card-qr")).toHaveCount(0);
    });
  }

  test("the Amharic card uses the business's own Amharic text", async ({ page }) => {
    await receive(page, "mock-ok-1-4567", "am");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("ናሙና ቡና ቤት");
    await expect(page.getByText("ሰላም Abebe")).toBeVisible();
  });
});

test.describe("privacy", () => {
  test("the card page is never indexed or cached", async ({ page, request }) => {
    await receive(page, "mock-ok-1-4567");
    const response = await page.request.get("/en/card");
    const headers = response.headers();
    expect(headers["x-robots-tag"]).toContain("noindex");
    expect(headers["cache-control"]).toMatch(/no-store|private/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    expect(
      (await request.get("/en/card/wallet", { maxRedirects: 0 })).headers()["x-robots-tag"],
    ).toContain("noindex");
  });

  test("the card endpoints refuse calls that do not come from the app's own pages", async ({
    request,
  }) => {
    const body = { token: "mock-ok-1-4567" };
    expect((await request.post("/api/card/session", { data: body })).status()).toBe(403);
    const foreign = await request.post("/api/card/session", {
      data: body,
      headers: { "x-requested-with": "tc-web", origin: "https://evil.example" },
    });
    expect(foreign.status()).toBe(403);
  });

  test("loads no third-party scripts, and the page makes no analytics calls", async ({ page }) => {
    const hosts = new Set<string>();
    page.on("request", (r) => hosts.add(new URL(r.url()).host));
    await receive(page, "mock-ok-1-4567");
    await expect(card(page)).toBeVisible();
    expect([...hosts]).toEqual([new URL(page.url()).host]);
  });
});

test.describe("accessibility and layout", () => {
  for (const token of ["mock-ok-1-4567", "mock-reward", "mock-inactive"]) {
    test(`${token}: no accessibility violations and no sideways scrolling`, async ({ page }) => {
      await receive(page, token);
      await expect(card(page)).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("wallet screen", () => {
  test("sends a visitor with no card to the card page", async ({ page }) => {
    await page.goto("/en/card/wallet");
    await expect(page).toHaveURL(/\/en\/card$/);
  });

  test("always offers the web card and explains this is not a payment card", async ({ page }) => {
    await receive(page, "mock-ok-1-4567");
    await page.getByRole("link", { name: "Add to your phone wallet" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Add your card to your phone");
    await expect(page.getByText(/not a payment card/).first()).toBeVisible();
    await page.getByRole("link", { name: "Open my web card" }).click();
    await expect(card(page)).toBeVisible();
  });

  test.describe("on an Android phone", () => {
    test.use({ userAgent: ANDROID });
    test("shows only Google Wallet and opens the link the backend gives", async ({ page }) => {
      await page.route("https://wallet.example.test/**", (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Wallet pass</h1>" }),
      );
      await receive(page, "mock-ok-google-1");
      await page.goto("/en/card/wallet");
      await expect(page.getByRole("button", { name: "Add to Google Wallet" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Add to Apple Wallet" })).toHaveCount(0);
      await page.getByRole("button", { name: "Add to Google Wallet" }).click();
      await expect(page).toHaveURL("https://wallet.example.test/google/pass");
    });

    test("points to the web card when the wallet is not set up", async ({ page }) => {
      await receive(page, "mock-ok-1-4567");
      await page.goto("/en/card/wallet");
      await page.getByRole("button", { name: "Add to Google Wallet" }).click();
      await expect(page.getByText("This wallet is not available right now.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Open my web card" })).toBeVisible();
    });
  });

  test.describe("on an iPhone", () => {
    test.use({ userAgent: IPHONE });
    test("shows only Apple Wallet", async ({ page }) => {
      await receive(page, "mock-ok-apple-1");
      await page.goto("/en/card/wallet");
      await expect(page.getByRole("button", { name: "Add to Apple Wallet" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Add to Google Wallet" })).toHaveCount(0);
    });
  });
});

test.describe("after signing up", () => {
  test("sign-up saves the card on the phone, offers the wallets, and opens the web card", async ({
    page,
  }) => {
    // A page that forgets to send a dictionary to the browser would silently show English text in Amharic.
    const missing: string[] = [];
    page.on("console", (message) => {
      if (message.text().includes("[i18n] Missing")) missing.push(message.text());
    });
    await page.goto("/en/join/sample-cafe");
    await expect(page.locator('form[data-hydrated="true"]')).toBeVisible();
    const tail = String(Math.floor(Math.random() * 9000) + 1000);
    await page.getByLabel(/^First name/).fill("Selam");
    await page.getByLabel(/^Phone number/).fill(`09777${tail}1`.slice(0, 10));
    await page.getByText(/^I agree to the terms/).click();
    await page.getByRole("button", { name: "Get my card" }).click();

    await expect(page.getByTestId("wallet-selector")).toBeVisible();
    await expect(page.getByText(/not a payment card/)).toBeVisible();
    expect(await page.content()).not.toContain("mock-ok-");
    await page.getByRole("link", { name: "Open my web card" }).click();
    await expect(page.getByText("Hello, Selam")).toBeVisible();
    await expect(page.getByRole("img", { name: "0 of 8 stamps" })).toBeVisible();
    expect(missing).toEqual([]);
  });
});
