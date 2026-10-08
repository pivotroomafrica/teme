import { defineConfig, devices } from "@playwright/test";

const PROD_PORT = 3101;
const DEV_PORT = 3102;

/**
 * Two servers:
 *  - a production build (mock-free, `TC_API_MODE=live` with an unreachable API) for the real-app tests;
 *  - the development server for the design-system gallery, which deliberately does not exist in production.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One local retry: the Next.js dev server occasionally fails on its first cold compile ("Unexpected end of JSON input").
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { trace: "on-first-retry" },
  projects: [
    {
      name: "mobile",
      testIgnore:
        /(design-system|auth|enrollment|card|scanner|dashboard|program|team).spec.ts|warmup.setup.ts/,
      use: { ...devices["Pixel 7"], baseURL: `http://localhost:${PROD_PORT}` },
    },
    {
      name: "desktop",
      testIgnore:
        /(design-system|auth|enrollment|card|scanner|dashboard|program|team).spec.ts|warmup.setup.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PROD_PORT}` },
    },
    {
      name: "warmup",
      testMatch: /warmup.setup.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${DEV_PORT}` },
    },
    {
      name: "dev-mobile",
      dependencies: ["warmup"],
      testMatch: /(design-system|auth|enrollment|card|scanner|dashboard|program|team).spec.ts/,
      // 360 CSS px wide: the narrowest phone we support.
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 360, height: 740 },
        baseURL: `http://localhost:${DEV_PORT}`,
      },
    },
    {
      name: "dev-desktop",
      dependencies: ["warmup"],
      testMatch: /(design-system|auth|enrollment|card|scanner|dashboard|program|team).spec.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${DEV_PORT}` },
    },
  ],
  webServer: [
    {
      command: `npm run build && npx next start -p ${PROD_PORT}`,
      url: `http://localhost:${PROD_PORT}/en`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: {
        NODE_ENV: "production",
        TC_API_MODE: "live",
        TC_API_BASE_URL: "https://api.test.invalid/api/v1",
        TC_SESSION_SECRET: "e2e-only-Zq8vN3tK1xW6pL9sD2fG5hJ7mB4cR0yU",
        NEXT_PUBLIC_APP_URL: `http://localhost:${PROD_PORT}`,
      },
    },
    {
      command: `npx next dev -p ${DEV_PORT}`,
      url: `http://localhost:${DEV_PORT}/en`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        TC_API_MODE: "mock",
        TC_SESSION_SECRET: "e2e-only-Zq8vN3tK1xW6pL9sD2fG5hJ7mB4cR0yU",
        NEXT_PUBLIC_APP_URL: `http://localhost:${DEV_PORT}`,
      },
    },
  ],
});
