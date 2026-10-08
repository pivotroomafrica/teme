import { expect, test, type Page } from "@playwright/test";

// Compiles routes in the dev server once, before the parallel dev-server tests start. The first request to
// each route is slow (and occasionally flaky) while Next.js compiles it, so do it here: one test, one route
// at a time, with a generous timeout. Protected pages only compile when a signed-in request reaches them,
// so each role signs in and visits its own pages.
const HEADERS = { "x-requested-with": "tc-web", origin: "http://localhost:3102" };
const OPEN = { timeout: 120_000 };

async function signIn(page: Page, email: string) {
  // Leave the previous page first: its dashboard queries would otherwise hit the cleared session, get a 401 and
  // send the browser to the session-expired page in the middle of the next navigation.
  await page.goto("about:blank");
  await page.context().clearCookies();
  const response = await page.request.post("/api/session/login", {
    headers: HEADERS,
    data: { email, password: "mock-password-1" },
    timeout: 120_000,
  });
  expect(response.status()).toBe(200);
}

async function visit(page: Page, paths: string[]) {
  for (const path of paths) {
    await page.goto(path, OPEN);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 120_000 });
  }
}

test("warm up the dev server", async ({ page, request }) => {
  test.setTimeout(900_000);

  await visit(page, [
    "/en/dev/design-system",
    "/am/dev/design-system",
    "/en/login",
    "/am/login",
    "/en/denied",
    "/en/session-expired",
    "/en/join/sample-cafe",
    "/am/join/sample-cafe",
    "/en/join/not-a-real-link",
    "/en/join/busy",
    "/en/card",
    "/en/card/wallet",
  ]);
  await request.post("/api/session/logout", { headers: HEADERS, data: {}, timeout: 120_000 });
  await request.get("/api/session/end?reason=expired", { maxRedirects: 0, timeout: 120_000 });
  await request.get("/api/bff/join/sample-cafe", { timeout: 120_000 });

  // Every protected route is visited as every kind of account: allowed pages compile their content,
  // forbidden ones compile the redirect to the access-denied page.
  const DASHBOARD = [
    "/en/dashboard",
    "/en/dashboard/program",
    "/en/dashboard/branches",
    "/en/dashboard/team",
    "/en/dashboard/customers",
    "/en/dashboard/rewards",
    "/en/dashboard/campaigns",
    "/en/dashboard/analytics",
    "/en/dashboard/audit",
    "/en/dashboard/settings",
  ];
  const OPERATIONS = [
    "/en/operations",
    "/en/operations/merchants",
    "/en/operations/fraud",
    "/en/operations/wallet-health",
    "/en/operations/privacy",
    "/en/operations/audit",
    "/en/operations/system",
  ];

  await signIn(page, "owner@mock.test");
  await visit(page, [...DASHBOARD, ...OPERATIONS, "/en/staff/branch", "/am/dashboard"]);
  await signIn(page, "manager@mock.test");
  await visit(page, [...DASHBOARD.slice(0, 3), ...OPERATIONS.slice(0, 3)]);

  await signIn(page, "staff@mock.test");
  await visit(page, ["/en/staff/branch"]);
  const branches = await page.request.get("/api/bff/merchant/branches", { timeout: 120_000 });
  const [first] = (await branches.json()) as Array<{ id: string }>;
  await page.request.post("/api/session/branch", {
    headers: HEADERS,
    data: { branchId: first!.id },
    timeout: 120_000,
  });
  await visit(page, ["/en/staff/scanner", "/am/staff/scanner", ...DASHBOARD, ...OPERATIONS]);

  await signIn(page, "admin@mock.test");
  await visit(page, [...OPERATIONS, "/am/operations", ...DASHBOARD, "/en/staff/scanner"]);
  await page.context().clearCookies();
});
