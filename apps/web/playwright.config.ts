import { randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import { defineConfig, devices } from "@playwright/test";
import { protectionBypassHeaders } from "./playwright.bypass";

// Load .env, .env.local, etc. exactly as `next build`/`next start` do, so the test runner sees the
// same env as the server it starts (the smoke spec gates the greeting assert on it).
nextEnv.loadEnvConfig(import.meta.dirname);

const port = Number(process.env.PORT ?? 3100);
// Set PLAYWRIGHT_BASE_URL to run the specs against a deployed app (a Vercel preview) instead of a local
// `next start`; then no web server is started (demo-officials.spec.ts signs in there).
const remote = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "");

// Flags Explorer overrides arrive in a cookie encrypted with FLAGS_SECRET (e2e/flags.spec.ts sets one).
// Without a real secret, a local run makes a throwaway one for this run only: setting it here passes it to
// the local server and to the workers (they inherit this env and re-read the config, so all agree). A
// deployed app has its own secret, so a remote run never gets a generated one.
if (!remote && !process.env.FLAGS_SECRET) process.env.FLAGS_SECRET = randomBytes(32).toString("base64url");

// Smoke tests only, chromium only, so ticket CI stays under 5 minutes.
export default defineConfig({
  testDir: "./e2e",
  grep: /@smoke/,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  // On a protected preview, VERCEL_AUTOMATION_BYPASS_SECRET lets requests past Vercel SSO.
  use: { baseURL: remote ?? `http://localhost:${port}`, extraHTTPHeaders: protectionBypassHeaders(process.env) },
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
