import nextEnv from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// Load .env, .env.local, etc. exactly as `next build`/`next start` do, so the test runner sees the
// same env as the server it starts (the smoke spec gates the greeting assert on it).
nextEnv.loadEnvConfig(import.meta.dirname);

const port = Number(process.env.PORT ?? 3100);
// Set PLAYWRIGHT_BASE_URL to run the specs against a deployed app (a Vercel preview) instead of a local
// `next start`; then no web server is started (demo-officials.spec.ts signs in there).
const remote = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "");

// Smoke tests only, chromium only, so ticket CI stays under 5 minutes.
export default defineConfig({
  testDir: "./e2e",
  grep: /@smoke/,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: remote ?? `http://localhost:${port}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: remote
    ? undefined
    : {
        command: `pnpm build && pnpm start --port ${port}`,
        url: `http://localhost:${port}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
