import { expect, test, type Page } from "@playwright/test";

/**
 * Security and performance checks against the PRODUCTION build (no mock backend, backend unreachable), on a phone and
 * on desktop. Everything signed-in is covered by hardening.spec.ts against the development server instead.
 */
const PUBLIC_PAGES = ["/en", "/am", "/en/login", "/am/login", "/en/join/sample-cafe", "/en/denied"];

/** Collects every Content-Security-Policy violation the browser reports while the page loads and settles. */
async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __csp: string[] }).__csp.push(
        `${event.violatedDirective} ${event.blockedURI}`,
      );
    });
  });
  const messages: string[] = [];
  page.on("console", (m) => {
    if (/content security policy/i.test(m.text())) messages.push(m.text());
  });
  return async () => [
    ...messages,
    ...(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])),
  ];
}

test.describe("content security policy", () => {
  test("every page gets a policy with a fresh nonce and no inline-script allowance", async ({
    request,
  }) => {
    const nonces = new Set<string>();
    for (const path of PUBLIC_PAGES) {
      const response = await request.get(path);
      const csp = response.headers()["content-security-policy"] ?? "";
      const script = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
      expect(script, path).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
      expect(script, path).toContain("'strict-dynamic'");
      expect(script, path).not.toContain("'unsafe-inline'");
      expect(script, path).not.toContain("'unsafe-eval'");
      expect(csp, path).toContain("frame-ancestors 'none'");
      expect(csp, path).toContain("object-src 'none'");
      nonces.add(/'nonce-([^']+)'/.exec(script)![1]!);
    }
    expect(nonces.size).toBe(PUBLIC_PAGES.length);
  });

  test("the nonce on the page's scripts is the one in the policy", async ({ request }) => {
    const response = await request.get("/en/login");
    const nonce = /'nonce-([^']+)'/.exec(response.headers()["content-security-policy"]!)![1]!;
    const html = await response.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag.includes(`nonce="${nonce}"`) || /type="application\/json"/.test(tag), tag).toBe(
        true,
      );
    }
  });

  for (const path of PUBLIC_PAGES) {
    test(`${path} loads and works with no policy violations`, async ({ page }) => {
      const violations = await watchViolations(page);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await violations()).toEqual([]);
    });
  }

  test("the sign-in form still hydrates and accepts typing under the policy", async ({ page }) => {
    const violations = await watchViolations(page);
    await page.goto("/en/login");
    await page.locator('form[data-hydrated="true"]').waitFor();
    await page.getByLabel(/^Email address/).fill("someone@example.org");
    await expect(page.getByLabel(/^Email address/)).toHaveValue("someone@example.org");
    expect(await violations()).toEqual([]);
  });

  test("the JSON routes are closed down completely", async ({ request }) => {
    const response = await request.get("/api/bff/platform/merchants");
    expect(response.headers()["content-security-policy"]).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });
});

test.describe("other security headers and indexing", () => {
  test("pages carry the standard protections", async ({ request }) => {
    const headers = (await request.get("/en/login")).headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["permissions-policy"]).toContain("camera=(self)");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("private pages are kept out of search results, the home page is not", async ({
    request,
  }) => {
    for (const path of [
      "/en/login",
      "/en/denied",
      "/en/dashboard",
      "/en/operations",
      "/en/staff/scanner",
      "/en/card",
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      const robots = response.headers()["x-robots-tag"];
      if (response.status() < 300) expect(robots, path).toContain("noindex");
    }
    const home = await request.get("/en");
    expect(home.headers()["x-robots-tag"]).toBeUndefined();
  });

  test("robots.txt lists the private areas", async ({ request }) => {
    const text = await (await request.get("/robots.txt")).text();
    for (const area of ["/en/dashboard", "/am/operations", "/en/staff", "/en/login", "/api/"]) {
      expect(text).toContain(`Disallow: ${area}`);
    }
  });
});

test.describe("requests", () => {
  test("the proxy refuses what it should", async ({ request }) => {
    expect((await request.get("/api/bff/platform/merchants")).status()).toBe(401);
    expect((await request.get("/api/bff/auth/login")).status()).toBe(404);
    expect((await request.get("/api/bff/merchant/..%2fauth/me")).status()).toBe(404);
  });

  test("a cross-site sign-in attempt is refused", async ({ request }) => {
    const response = await request.post("/api/session/login", {
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      data: { email: "a@b.co", password: "x" },
    });
    expect(response.status()).toBe(403);
  });

  test("the production page contains no mock backend or server configuration", async ({
    request,
  }) => {
    const html = await (await request.get("/en/login")).text();
    for (const needle of [
      "mock-password-1",
      "mock-access.",
      "owner@mock.test",
      "TC_SESSION_SECRET",
    ]) {
      expect(html).not.toContain(needle);
    }
  });
});

test.describe("slow connections", () => {
  test("the first page is usable on a slow mobile network and ships little script", async ({
    page,
    context,
  }, info) => {
    test.skip(
      !info.project.name.includes("mobile"),
      "network throttling is measured on the phone profile",
    );
    const client = await context.newCDPSession(page);
    await client.send("Network.enable");
    await client.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 400,
      downloadThroughput: (400 * 1024) / 8,
      uploadThroughput: (400 * 1024) / 8,
    });
    const started = Date.now();
    await page.goto("/en/login", { waitUntil: "domcontentloaded" });
    await page.locator('form[data-hydrated="true"]').waitFor({ timeout: 45_000 });
    const seconds = (Date.now() - started) / 1000;

    const transferred = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((e) => e.name.endsWith(".js"))
        .reduce((sum, e) => sum + ((e as PerformanceResourceTiming).transferSize || 0), 0),
    );
    // Generous ceilings that still catch a regression: a full sign-in page on a slow network, and script bytes on the wire.
    expect(seconds).toBeLessThan(30);
    expect(transferred / 1024).toBeLessThan(350);
    await client.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  });
});

test.describe("motion", () => {
  test("animations and transitions are switched off for people who ask for reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/en/login");
    const durations = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll("button, a, input, html"))) {
        const style = getComputedStyle(el);
        out.push(style.transitionDuration, style.animationDuration);
      }
      return out;
    });
    for (const value of durations) {
      for (const part of value.split(",")) {
        expect(parseFloat(part), value).toBeLessThanOrEqual(0.011);
      }
    }
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
    ).toBe("auto");
  });
});
