import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";
import { fakeCameraArgs, writeQrVideo } from "./support/fake-camera";

/**
 * The staff scanner in a real browser against the mock backend. Card codes are "scanned" two ways: typed into the
 * manual box, and through Chromium's fake camera showing a real QR picture (mocked QR input, real decoding).
 */
const unique = () => Math.random().toString(36).slice(2, 10);
const okCard = () => `mock-ok-${unique()}`; // 2 of 8 stamps
const almostCard = () => `mock-almost-${unique()}`; // 7 of 8: the next stamp unlocks a reward
const rewardCard = () => `mock-reward-${unique()}`; // a reward is waiting

// Chromium shows this card as a picture on its fake camera. (Browser launch options cannot be set inside a
// describe block, so they apply to the whole file; tests that need no camera simply never start it.)
const CAMERA_CARD = rewardCard();
test.use({
  permissions: ["camera"],
  launchOptions: { args: fakeCameraArgs(writeQrVideo(CAMERA_CARD)) },
});

async function openScanner(page: Page, locale = "en") {
  await page.goto(`/${locale}/login`);
  await page.locator('form[data-hydrated="true"]').waitFor();
  await page.getByLabel(/^(Email address|የኢሜይል አድራሻ)/).fill("staff@mock.test");
  await page.getByLabel(/^(Password|የይለፍ ቃል)/).fill("mock-password-1");
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(new RegExp(`/${locale}/staff/branch$`));
  await page.locator('main [data-hydrated="true"]').waitFor();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: /^(Use this branch|ይህን ቅርንጫፍ ተጠቀም)/ }).click();
  await page.waitForURL(new RegExp(`/${locale}/staff/scanner$`));
  await expect(page.getByTestId("scanner")).toBeVisible();
  // Interactive once the manual-entry form (a client component) is on the page.
  await expect(page.getByRole("textbox", { name: /^(Card code|የካርድ ኮድ)/ })).toBeEnabled();
}

async function enterCode(page: Page, code: string) {
  await page.getByRole("textbox", { name: /^Card code/ }).fill(code);
  await page.getByRole("button", { name: "Look up" }).first().click();
}

const phase = (page: Page) => page.getByTestId("scanner");

test.describe("the scanner screen", () => {
  test("shows the branch, the connection state and a camera that waits to be started", async ({
    page,
  }) => {
    await openScanner(page);
    await expect(page.getByText("Working at Bole")).toBeVisible();
    await expect(page.getByTestId("connection")).toHaveText("Online");
    await expect(page.getByTestId("camera-view")).toHaveAttribute("data-camera", "off");
    await expect(page.getByRole("button", { name: "Start camera" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Switch branch" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Selam Cashier/ })).toBeVisible();
  });

  test("main actions are big enough for one thumb", async ({ page }) => {
    await openScanner(page);
    for (const name of ["Start camera", "Look up"]) {
      const box = await page.getByRole("button", { name }).first().boundingBox();
      expect(box!.height, name).toBeGreaterThanOrEqual(48);
    }
  });

  test("has no accessibility violations and does not scroll sideways", async ({ page }) => {
    await openScanner(page);
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

test.describe("adding a stamp", () => {
  test("checks, asks for confirmation, then shows a large success only after the backend confirms", async ({
    page,
  }) => {
    const sent: Request[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/scanner/stamps")) sent.push(r);
    });
    await openScanner(page);
    await enterCode(page, okCard());

    await expect(page.getByTestId("scan-confirm")).toBeVisible();
    await expect(page.getByTestId("customer-name")).toHaveText("Abebe");
    await expect(page.getByRole("img", { name: "2 of 8 stamps" })).toBeVisible();
    expect(sent).toHaveLength(0); // nothing written yet

    await page.getByRole("button", { name: "Add stamp" }).click();
    const success = page.getByTestId("scan-success");
    await expect(success).toBeVisible();
    await expect(success).toContainText("Stamp added");
    await expect(success).toContainText("Abebe: 3 of 8 stamps");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers()["idempotency-key"]).toMatch(/^[\w.:-]{8,128}$/);
    // The card code travels in the request body only, never in an address.
    expect(sent[0]!.url()).not.toContain("mock-ok");

    // The success symbol is drawn, so the result never depends on colour alone.
    await expect(success.locator("svg")).toBeVisible();

    await page.getByRole("button", { name: "Scan next card" }).click();
    await expect(phase(page)).toHaveAttribute("data-phase", "ready");
    await expect(page.getByTestId("recent-list")).toContainText("Stamp added: Abebe");
  });

  test("returns to scanning by itself after a successful stamp", async ({ page }) => {
    await openScanner(page);
    await enterCode(page, okCard());
    await page.getByRole("button", { name: "Add stamp" }).click();
    await expect(page.getByTestId("scan-success")).toBeVisible();
    await expect(phase(page)).toHaveAttribute("data-phase", "ready", { timeout: 10_000 });
  });

  test("a card that completes unlocks a reward, shown clearly", async ({ page }) => {
    await openScanner(page);
    await enterCode(page, almostCard());
    await expect(
      page.getByText("This stamp completes the card and unlocks a reward."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add stamp" }).click();
    await expect(page.getByTestId("scan-success")).toContainText("Reward unlocked: Free coffee");
  });

  test("sends one stamp however many times Add stamp is tapped", async ({ page }) => {
    let sent = 0;
    await page.route("**/api/bff/scanner/stamps", async (route) => {
      sent += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });
    await openScanner(page);
    await enterCode(page, okCard());
    await page.getByRole("button", { name: "Add stamp" }).dblclick();
    await expect(page.getByTestId("scan-success")).toBeVisible();
    expect(sent).toBe(1);
  });

  test("works in Amharic", async ({ page }) => {
    await openScanner(page, "am");
    await page.getByRole("textbox", { name: /^የካርድ ኮድ/ }).fill(okCard());
    await page.getByRole("button", { name: "ፈልግ" }).first().click();
    await page.getByRole("button", { name: "ማህተም ጨምር" }).click();
    await expect(page.getByTestId("scan-success")).toContainText("ማህተም ተጨምሯል");
  });
});

test.describe("rejections", () => {
  for (const [label, token, title] of [
    ["cooldown", "mock-cooldown-1", "Too soon for another stamp"],
    ["an inactive membership", "mock-inactive-1", "Membership not active"],
    [
      "a card that is not valid here (including another business's)",
      "totally-unknown-card",
      "Card not recognised",
    ],
  ] as const) {
    test(`shows ${label} as a large rejection with a symbol and words`, async ({ page }) => {
      await openScanner(page);
      await enterCode(page, token);
      const rejected = page.getByTestId("scan-rejected");
      await expect(rejected).toBeVisible();
      await expect(rejected).toContainText(title);
      await expect(rejected.locator("svg")).toBeVisible();
      await expect(page.getByRole("button", { name: "Add stamp" })).toHaveCount(0);
      await page.getByRole("button", { name: "Scan next card" }).click();
      await expect(phase(page)).toHaveAttribute("data-phase", "ready");
    });
  }

  test("tells staff how long a cooldown lasts", async ({ page }) => {
    await openScanner(page);
    await enterCode(page, "mock-cooldown-2");
    await expect(page.getByTestId("scan-rejected")).toContainText("Try again in 2 minutes.");
  });

  test("a code that is not a card never reaches the backend", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/bff/scanner/**", (route) => {
      calls += 1;
      return route.continue();
    });
    await openScanner(page);
    await enterCode(page, "https://example.com/menu");
    await expect(page.getByTestId("scan-rejected")).toContainText(
      "That code is not a loyalty card.",
    );
    expect(calls).toBe(0);
  });
});

test.describe("rewards", () => {
  test("keeps redeeming separate from stamping and asks for confirmation", async ({ page }) => {
    const redeemed: Request[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/scanner/redemptions")) redeemed.push(r);
    });
    await openScanner(page);
    await enterCode(page, rewardCard());

    const section = page.getByTestId("reward-section");
    await expect(section).toContainText("Reward available");
    await expect(section).toContainText("Free coffee");
    await expect(page.getByRole("button", { name: "Add stamp" })).toBeVisible();

    await section.getByRole("button", { name: "Redeem reward" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Abebe will receive: Free coffee");
    expect(redeemed).toHaveLength(0);
    await dialog.getByRole("button", { name: "No, go back" }).click();
    expect(redeemed).toHaveLength(0);

    await section.getByRole("button", { name: "Redeem reward" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Redeem reward" }).click();
    const success = page.getByTestId("redeem-success");
    await expect(success).toContainText("Reward redeemed");
    await expect(success).toContainText("Hand over: Free coffee");
    expect(redeemed).toHaveLength(1);
    expect(redeemed[0]!.headers()["idempotency-key"]).toMatch(/^[\w.:-]{8,128}$/);
  });

  test("a reward is given once: the same card shows none afterwards", async ({ page }) => {
    const token = rewardCard();
    await openScanner(page);
    await enterCode(page, token);
    await page.getByTestId("reward-section").getByRole("button", { name: "Redeem reward" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Redeem reward" }).click();
    await expect(page.getByTestId("redeem-success")).toBeVisible();
    await page.getByRole("button", { name: "Scan next card" }).click();
    await enterCode(page, token);
    await expect(page.getByTestId("scan-confirm")).toBeVisible();
    await expect(page.getByTestId("reward-section")).toHaveCount(0);
  });

  test("redeems once even if the confirm button is double-clicked", async ({ page }) => {
    let sent = 0;
    await page.route("**/api/bff/scanner/redemptions", async (route) => {
      sent += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });
    await openScanner(page);
    await enterCode(page, rewardCard());
    await page.getByTestId("reward-section").getByRole("button", { name: "Redeem reward" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Redeem reward" }).dblclick();
    await expect(page.getByTestId("redeem-success")).toBeVisible();
    expect(sent).toBe(1);
  });
});

test.describe("when something goes wrong", () => {
  test("a lost connection mid-stamp is never shown as success; checking again reuses the key", async ({
    page,
  }) => {
    const keys: Array<string | undefined> = [];
    let attempt = 0;
    await page.route("**/api/bff/scanner/stamps", (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      attempt += 1;
      return attempt === 1 ? route.abort("connectionreset") : route.continue();
    });
    await openScanner(page);
    await enterCode(page, okCard());
    await page.getByRole("button", { name: "Add stamp" }).click();

    const problem = page.getByTestId("scan-problem");
    await expect(problem).toContainText("could not confirm whether the stamp was added");
    await expect(page.getByTestId("scan-success")).toHaveCount(0);
    expect(attempt).toBe(1); // nothing is retried by itself

    await problem.getByRole("button", { name: "Check again" }).click();
    await expect(page.getByTestId("scan-success")).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  test("shows the server being unavailable", async ({ page }) => {
    await page.route("**/api/bff/scanner/validate", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "HTTP_503", message: "down", requestId: "r" } }),
      }),
    );
    await openScanner(page);
    await enterCode(page, okCard());
    const problem = page.getByTestId("scan-problem");
    await expect(problem).toHaveAttribute("data-kind", "unavailable");
    await expect(problem).toContainText("Service unavailable");
  });

  test("shows permission denied, without a retry button", async ({ page }) => {
    for (const path of ["validate", "rewards/lookup"]) {
      await page.route(`**/api/bff/scanner/${path}`, (route) =>
        route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "FORBIDDEN", message: "no", requestId: "r" } }),
        }),
      );
    }
    await openScanner(page);
    await enterCode(page, okCard());
    const problem = page.getByTestId("scan-problem");
    await expect(problem).toHaveAttribute("data-kind", "permission");
    await expect(problem).toContainText("You are not allowed to do this");
    await expect(problem.getByRole("button", { name: "Check again" })).toHaveCount(0);
  });

  test("offline: says so, blocks scanning, and recovers", async ({ page, context }) => {
    await openScanner(page);
    await context.setOffline(true);
    await expect(page.getByTestId("connection")).toHaveText("Offline");
    await expect(page.getByText("No internet connection").first()).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^Card code/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Look up" }).first()).toBeDisabled();

    await context.setOffline(false);
    await expect(page.getByTestId("connection")).toHaveText("Online");
    await expect(page.getByRole("textbox", { name: /^Card code/ })).toBeEnabled();
  });

  test("Add stamp is disabled while offline, so nothing can be queued", async ({
    page,
    context,
  }) => {
    let sent = 0;
    await page.route("**/api/bff/scanner/stamps", (route) => {
      sent += 1;
      return route.continue();
    });
    await openScanner(page);
    await enterCode(page, okCard());
    await expect(page.getByRole("button", { name: "Add stamp" })).toBeEnabled();
    await context.setOffline(true);
    await expect(page.getByRole("button", { name: "Add stamp" })).toBeDisabled();
    expect(sent).toBe(0);
  });
});

test.describe("manual fallback", () => {
  test("finds a member by their complete phone number, read-only", async ({ page }) => {
    let stamps = 0;
    await page.route("**/api/bff/scanner/stamps", (route) => {
      stamps += 1;
      return route.continue();
    });
    await openScanner(page);
    await page.getByRole("tab", { name: "Phone number" }).click();
    await page.getByRole("textbox", { name: /Phone number/ }).fill("0911000111");
    await page.getByRole("button", { name: "Look up" }).first().click();
    const results = page.getByTestId("lookup-results");
    await expect(results).toContainText("Abebe");
    await expect(results).toContainText("*****111");
    await expect(results).toContainText("scan its code");
    expect(stamps).toBe(0);
  });

  test("says when no member has that number, and asks for a complete number", async ({ page }) => {
    await openScanner(page);
    await page.getByRole("tab", { name: "Phone number" }).click();
    await page.getByRole("textbox", { name: /Phone number/ }).fill("0911");
    await page.getByRole("button", { name: "Look up" }).first().click();
    await expect(page.getByText("Enter the complete phone number.")).toBeVisible();
    await page.getByRole("textbox", { name: /Phone number/ }).fill("0911999999");
    await page.getByRole("button", { name: "Look up" }).first().click();
    await expect(page.getByText("No member found with that number.")).toBeVisible();
  });
});

test.describe("the camera", () => {
  test.describe("with a camera that shows a QR code", () => {
    test("reads the code, checks it with the backend, and releases the camera when told to stop", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __streams: MediaStream[] };
        w.__streams = [];
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          const stream = await original(constraints);
          w.__streams.push(stream);
          return stream;
        };
      });
      await openScanner(page);
      await page.getByRole("button", { name: "Start camera" }).click();
      await expect(page.getByTestId("camera-view")).toHaveAttribute("data-camera", "live");

      // The picture contained a real QR code: it was decoded in the browser and checked with the backend.
      await expect(page.getByTestId("scan-confirm")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("reward-section")).toBeVisible();
      // While a card is being handled the camera is not needed.
      await page.getByRole("button", { name: "Cancel and scan another card" }).click();
      await expect(phase(page)).toHaveAttribute("data-phase", "ready");

      await page.getByRole("button", { name: "Stop camera" }).click();
      await expect(page.getByTestId("camera-view")).toHaveAttribute("data-camera", "off");
      const live = await page.evaluate(
        () =>
          (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) =>
            s.getTracks().filter((t) => t.readyState === "live"),
          ).length,
      );
      expect(live).toBe(0);
    });

    test("lets go of the camera when staff leave the page", async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __streams: MediaStream[] };
        w.__streams = [];
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          const stream = await original(constraints);
          w.__streams.push(stream);
          return stream;
        };
      });
      await openScanner(page);
      await page.getByRole("button", { name: "Start camera" }).click();
      await expect(page.getByTestId("camera-view")).toHaveAttribute("data-camera", "live");

      // A client-side move to another page: the scanner unmounts but the browser window lives on.
      await page.getByRole("link", { name: "Switch branch" }).first().click();
      await expect(page).toHaveURL(/\/staff\/branch$/);
      const live = await page.evaluate(
        () =>
          (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) =>
            s.getTracks().filter((t) => t.readyState === "live"),
          ).length,
      );
      expect(live).toBe(0);
    });

    test("keeps no picture: nothing is uploaded and no video or image is stored", async ({
      page,
    }) => {
      const uploads: string[] = [];
      page.on("request", (r) => {
        const type = r.headers()["content-type"] ?? "";
        if (r.method() !== "GET" && /image|video|octet-stream|multipart/.test(type))
          uploads.push(r.url());
      });
      await openScanner(page);
      await page.getByRole("button", { name: "Start camera" }).click();
      await expect(page.getByTestId("scan-confirm")).toBeVisible({ timeout: 15_000 });
      expect(uploads).toEqual([]);
      const stored = await page.evaluate(() => ({
        local: JSON.stringify({ ...localStorage }),
        session: JSON.stringify({ ...sessionStorage }),
        blobs: document.querySelectorAll('img[src^="blob:"], img[src^="data:"], a[download]')
          .length,
      }));
      expect(stored.local).not.toMatch(/data:image|blob:/);
      expect(stored.session).not.toMatch(/data:image|blob:/);
      expect(stored.blobs).toBe(0);
    });
  });

  test.describe("when camera permission is refused", () => {
    test.use({ permissions: [] });
    test("explains it and leaves manual entry working", async ({ page }) => {
      await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () =>
          Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
      });
      await openScanner(page);
      await page.getByRole("button", { name: "Start camera" }).click();
      await expect(page.getByTestId("camera-view")).toHaveAttribute("data-camera", "denied");
      await expect(page.getByText(/Camera access is blocked/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Try the camera again" })).toBeVisible();
      await enterCode(page, okCard());
      await expect(page.getByTestId("scan-confirm")).toBeVisible();
    });
  });

  test("explains a device with no usable camera", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    });
    await openScanner(page);
    await page.getByRole("button", { name: "Start camera" }).click();
    await expect(page.getByTestId("camera-view")).toHaveAttribute("data-camera", "unsupported");
    await expect(page.getByText(/no usable camera/)).toBeVisible();
    await enterCode(page, okCard());
    await expect(page.getByTestId("scan-confirm")).toBeVisible();
  });
});
