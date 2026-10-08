import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const AREAS = [
  { path: "/en", heading: /TemelashCard/ },
  { path: "/en/login", heading: /Sign in/ },
  { path: "/en/card", heading: /No card on this phone/ },
  { path: "/am", heading: /TemelashCard/ },
  { path: "/am/login", heading: /ግባ/ },
];

test.describe("language routing", () => {
  test("sends a visitor without a language to English by default", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test.describe("Amharic browser", () => {
    test.use({ locale: "am-ET" });
    test("is sent to the Amharic site and keeps the page left to right", async ({ page }) => {
      await page.goto("/join/sample-cafe");
      await expect(page).toHaveURL(/\/am\/join\/sample-cafe$/);
      await expect(page.locator("html")).toHaveAttribute("lang", "am");
      await expect(page.locator("html")).not.toHaveAttribute("dir", "rtl");
    });
  });

  test("switches language on the same page and remembers it", async ({ page, context }) => {
    await page.goto("/en/login");
    await page.getByRole("link", { name: "አማርኛ" }).first().click();
    await expect(page).toHaveURL(/\/am\/login$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/ግባ/);
    // The proxy sets the cookie on the navigation response; wait for the browser to store it.
    await expect
      .poll(async () => (await context.cookies()).find((c) => c.name === "tc_locale")?.value)
      .toBe("am");
    await page.goto("/");
    await expect(page).toHaveURL(/\/am$/);
  });
});

test.describe("route groups", () => {
  for (const area of AREAS) {
    test(`${area.path} renders its own shell with a main landmark and a heading`, async ({
      page,
    }) => {
      const response = await page.goto(area.path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(area.heading);
    });
  }

  test("signed-in areas turn visitors away to the sign-in page, remembering where they were going", async ({
    page,
  }) => {
    for (const path of [
      "/en/staff/scanner",
      "/en/dashboard",
      "/en/dashboard/team",
      "/en/operations",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent(path)}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Sign in/);
    }
  });
});

test.describe("join page without a reachable backend", () => {
  test("offers a retry instead of breaking", async ({ page }) => {
    const response = await page.goto("/en/join/sample-cafe");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("We could not load this page");
    await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
  });
});

test.describe("errors", () => {
  test("shows a localized 404 with the right status", async ({ page }) => {
    const response = await page.goto("/en/this/page/does/not/exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
    await page.getByRole("link", { name: "Go to the home page" }).click();
    await expect(page).toHaveURL(/\/en$/);
  });

  test("shows the Amharic 404", async ({ page }) => {
    const response = await page.goto("/am/nope");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ገጹ አልተገኘም");
  });

  test("treats an unsupported language as an ordinary missing page", async ({ page }) => {
    const response = await page.goto("/fr/login");
    expect(response?.status()).toBe(404);
  });
});

test.describe("security headers and indexing", () => {
  test("the design-system gallery does not exist in production", async ({ page }) => {
    const response = await page.goto("/en/dev/design-system");
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId("design-system")).toHaveCount(0);
  });

  test("sends the baseline security headers on pages", async ({ request }) => {
    const res = await request.get("/en");
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).toContain("object-src 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("camera=(self)");
    expect(h["strict-transport-security"]).toContain("max-age=");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  for (const path of [
    "/en/login",
    "/en/card",
    "/en/staff/scanner",
    "/en/dashboard",
    "/en/operations",
  ]) {
    test(`keeps ${path} out of search engines`, async ({ request, page }) => {
      const res = await request.get(path);
      expect(res.headers()["x-robots-tag"]).toContain("noindex");
      await page.goto(path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    });
  }

  test("does not ship secrets or server configuration to the browser", async ({ page }) => {
    const bodies: string[] = [];
    page.on("response", async (r) => {
      if (/\.(js|html)$|\/en/.test(r.url())) bodies.push(await r.text().catch(() => ""));
    });
    await page.goto("/en");
    await page.waitForLoadState("networkidle");
    const all = bodies.join("\n");
    expect(all).not.toContain("TC_SESSION_SECRET");
    expect(all).not.toContain("e2e-only-Zq8v");
    expect(all).not.toContain("api.test.invalid");
  });
});

test.describe("accessibility", () => {
  test("offers a working skip link as the first tab stop", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard-only behaviour");
    await page.goto("/en/dashboard");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });

  for (const area of AREAS) {
    test(`${area.path} has no detectable accessibility violations`, async ({ page }) => {
      await page.goto(area.path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  }

  test("never scrolls sideways on a phone", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone viewport only");
    for (const area of AREAS) {
      await page.goto(area.path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, area.path).toBeLessThanOrEqual(0);
    }
  });
});
