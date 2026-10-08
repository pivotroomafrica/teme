import { expect, test } from "@playwright/test";

const PUBLIC_PAGES = [
  "/am",
  "/am/login",
  "/am/join/sample-cafe",
  "/am/card",
  "/am/denied",
  "/am/session-expired",
];

test.describe("locale-aware metadata", () => {
  test("describes the page in the visitor's language", async ({ page }) => {
    await page.goto("/am");
    await expect(page.locator("html")).toHaveAttribute("lang", "am");
    await expect(page).toHaveTitle(/TemelashCard/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /ለሚወዷቸው/);
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "am_ET");

    await page.goto("/en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /Digital loyalty cards/,
    );
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "en_ET");
  });

  test("the home page points search engines at each language version", async ({ page }) => {
    await page.goto("/am");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/am$/);
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
      "href",
      /\/en$/,
    );
    await expect(page.locator('link[rel="alternate"][hreflang="am"]')).toHaveAttribute(
      "href",
      /\/am$/,
    );
  });

  test("translates page titles", async ({ page }) => {
    await page.goto("/am/login");
    await expect(page).toHaveTitle(/ግባ \| TemelashCard/);
    await page.goto("/en/login");
    await expect(page).toHaveTitle(/Sign in \| TemelashCard/);
  });
});

test.describe("language switching", () => {
  test("keeps the visitor on the same page, including the join reference", async ({ page }) => {
    await page.goto("/en/join/sample-cafe");
    await page.getByRole("link", { name: "አማርኛ" }).first().click();
    await expect(page).toHaveURL(/\/am\/join\/sample-cafe$/);
    await page.getByRole("link", { name: "English" }).first().click();
    await expect(page).toHaveURL(/\/en\/join\/sample-cafe$/);
  });
});

test.describe("Amharic layout", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} stays left to right and nothing is clipped`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("html")).not.toHaveAttribute("dir", "rtl");
      const overflow = await page.evaluate(() => {
        const bad: string[] = [];
        const page = document.documentElement;
        if (page.scrollWidth > page.clientWidth) bad.push("page scrolls sideways");
        for (const el of document.querySelectorAll<HTMLElement>(
          "button, a, label, h1, h2, p, li",
        )) {
          const style = getComputedStyle(el);
          const clips = style.overflow === "hidden" || style.textOverflow === "ellipsis";
          // A visually hidden element (the skip link until it is focused) is clipped on purpose.
          if (
            clips &&
            !el.matches(".sr-only-focusable:not(:focus)") &&
            el.scrollWidth > el.clientWidth + 1
          ) {
            bad.push(`${el.tagName} "${(el.textContent ?? "").slice(0, 30)}"`);
          }
        }
        return bad;
      });
      expect(overflow).toEqual([]);
    });
  }
});
