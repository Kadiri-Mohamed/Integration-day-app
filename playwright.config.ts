import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", ...devices["Desktop Chrome"] },
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run dev -- --hostname 127.0.0.1", url: baseURL, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
