import { writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ROUTES = ["/en/dev/design-system", "/am/dev/design-system"];

async function open(page: Page, path: string) {
  await page.goto(path);
  // The first visit compiles the route in the dev server, so allow time for it.
  await expect(page.getByTestId("design-system")).toBeVisible({ timeout: 45_000 });
}

for (const route of ROUTES) {
  test.describe(route, () => {
    test("has no accessibility violations, including colour contrast", async ({ page }) => {
      await open(page, route);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
        .analyze();
      expect(
        results.violations.map(
          (v) =>
            `${v.id}: ${v.help} -> ${v.nodes
              .map((n) => n.target.join(" "))
              .slice(0, 3)
              .join(" | ")}`,
        ),
      ).toEqual([]);
    });

    test("never overflows the screen, even with long Amharic text", async ({ page }) => {
      await open(page, route);
      const problems = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const out: string[] = [];
        const scrollers = Array.from(
          document.querySelectorAll('[role="region"][tabindex="0"], [role="tablist"]'),
        );
        for (const el of document.querySelectorAll("main *")) {
          if (scrollers.some((s) => s !== el && s.contains(el))) continue;
          const box = el.getBoundingClientRect();
          if (box.width === 0) continue;
          if (box.right > width + 1)
            out.push(
              `${el.tagName}.${(el as HTMLElement).className.toString().slice(0, 40)} right=${Math.round(box.right)} > ${width}`,
            );
          const style = getComputedStyle(el);
          if (
            (style.overflowX === "hidden" || style.overflowX === "clip") &&
            el.scrollWidth > el.clientWidth + 1 &&
            el.getAttribute("role") !== "progressbar" &&
            !el.classList.contains("sr-only")
          ) {
            out.push(`clipped: ${el.tagName} ${(el.textContent ?? "").slice(0, 30)}`);
          }
        }
        if (document.documentElement.scrollWidth > width + 1) out.push("page scrolls sideways");
        return out;
      });
      expect(problems).toEqual([]);
    });

    test("gives every control a comfortable touch target", async ({ page }) => {
      await open(page, route);
      const small = await page.evaluate(() => {
        const out: string[] = [];
        const selector =
          'button, select, input:not([type="checkbox"]):not([type="radio"]), [role="tab"], [role="switch"], [role="menuitem"]';
        for (const el of document.querySelectorAll(selector)) {
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          if (box.height < 43.5 || box.width < 43.5) {
            out.push(
              `${el.tagName} "${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 25)}" ${Math.round(box.width)}x${Math.round(box.height)}`,
            );
          }
        }
        // Checkboxes and radios: the labelled row is the target.
        for (const el of document.querySelectorAll('input[type="checkbox"], input[type="radio"]')) {
          const row = el.closest("label, div");
          const box = row?.getBoundingClientRect();
          if (box && box.height < 43.5)
            out.push(`${(el as HTMLInputElement).type} row ${Math.round(box.height)}px`);
        }
        return out;
      });
      expect(small).toEqual([]);
    });

    test("shows a visible focus ring on every keyboard stop", async ({ page, isMobile }) => {
      test.skip(isMobile, "keyboard-only behaviour");
      await open(page, route);
      const failures: string[] = [];
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press("Tab");
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          return {
            name: (el.textContent ?? el.getAttribute("aria-label") ?? el.tagName)
              .trim()
              .slice(0, 25),
            width: parseFloat(s.outlineWidth),
            style: s.outlineStyle,
          };
        });
        if (info && (info.style === "none" || info.width < 2))
          failures.push(`${info.name}: ${info.style} ${info.width}px`);
      }
      expect(failures).toEqual([]);
    });

    test("honours reduced motion", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await open(page, route);
      const durations = await page.evaluate(() => {
        const spinner = document.querySelector('button[aria-busy="true"] span[aria-hidden="true"]');
        const knob = document.querySelector('[role="switch"] span span');
        const seconds = (v: string) => Math.max(...v.split(",").map((x) => parseFloat(x)));
        return {
          spinner: spinner ? seconds(getComputedStyle(spinner).animationDuration) : null,
          knob: knob ? seconds(getComputedStyle(knob).transitionDuration) : null,
        };
      });
      expect(durations.spinner).not.toBeNull();
      expect(durations.spinner!).toBeLessThan(0.01);
      expect(durations.knob!).toBeLessThan(0.01);
    });
  });
}

test.describe("interaction in a real browser", () => {
  test("a dialog traps focus, closes with Escape and returns focus to its opener", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "keyboard behaviour");
    await open(page, "/en/dev/design-system");
    const opener = page.getByRole("button", { name: "Open dialog" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Dialog title" });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      // Focus may leave the page for the browser toolbar (body), but never lands on page content behind the dialog.
      expect(
        await dialog.evaluate(
          (d) => d.contains(document.activeElement) || document.activeElement === document.body,
        ),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("the strong confirmation stays locked until the phrase is typed", async ({ page }) => {
    await open(page, "/en/dev/design-system");
    await page.getByRole("button", { name: "Strong confirmation" }).click();
    const confirm = page.getByRole("button", { name: "Reverse stamp" });
    await expect(confirm).toBeDisabled();
    await page.getByLabel("Type REVERSE to confirm").fill("REVERSE");
    await expect(confirm).toBeEnabled();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("a toast is announced in a live region and can be dismissed", async ({ page }) => {
    await open(page, "/en/dev/design-system");
    await page.getByRole("button", { name: "Error toast" }).click();
    const region = page.getByRole("region", { name: "Notifications" });
    await expect(region.locator('[aria-live="assertive"]')).toContainText("Could not save");
    await region.getByRole("button", { name: "Dismiss" }).click();
    await expect(region).not.toContainText("Could not save");
  });

  test("the action menu works from the keyboard", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard behaviour");
    await open(page, "/en/dev/design-system");
    const trigger = page.getByRole("button", { name: /^Actions/ });
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "Edit" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("tabs move with the arrow keys", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard behaviour");
    await open(page, "/en/dev/design-system");
    const first = page.getByRole("tab", { name: "Overview" });
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Branches" })).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: "Branches" })).toBeVisible();
  });

  test("captures the gallery for visual review", async ({ page }, testInfo) => {
    for (const locale of ["en", "am"]) {
      await open(page, `/${locale}/dev/design-system`);
      const image = await page.screenshot({ fullPage: true, caret: "initial" });
      await testInfo.attach(`gallery-${locale}`, { body: image, contentType: "image/png" });
      await writeFile(testInfo.outputPath(`gallery-${locale}-${testInfo.project.name}.png`), image);
    }
  });
});
