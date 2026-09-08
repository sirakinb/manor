import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-marketing",
  outputDir: "../../test-report/marketing",
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4321",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command:
      "pnpm --filter @rakazo/www build && exec python3 -m http.server 4321 --bind 127.0.0.1 --directory ../www/dist",
    url: "http://127.0.0.1:4321",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
