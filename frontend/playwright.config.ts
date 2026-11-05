import { defineConfig, devices } from "@playwright/test";

const frontendOrigin = process.env.TEST_FRONTEND_ORIGIN ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: frontendOrigin, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: frontendOrigin,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
