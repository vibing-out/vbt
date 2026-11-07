import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3100);

// Smoke tests only, chromium only, so ticket CI stays under 5 minutes.
export default defineConfig({
  testDir: "./e2e",
  grep: /@smoke/,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm build && pnpm start --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
