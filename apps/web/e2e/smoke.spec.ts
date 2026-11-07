import { expect, test } from "@playwright/test";

// The tests run against a local `next start` (see playwright.config.ts), which loads env from the
// process and from .env* files; the config loads the same files into this runner. When the product
// database env is set (CI secrets or a local .env.local), the greeting must be the real database
// value; without it, that test is reported as skipped rather than passing silently.
const hasProductDb = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

test("status page renders greeting, demo-feature flags and context-log region @smoke", async ({ page }) => {
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "VBT" })).toBeVisible();
  await expect(page.getByTestId("greeting")).toBeVisible();

  await expect(page.getByTestId("demo-features")).toBeVisible();
  await expect(page.getByTestId("flag-mismatch-view")).toHaveText(/^Mismatch view: (on|off)$/);
  await expect(page.getByTestId("flag-challenge-discard-flow")).toHaveText(/^Challenge and discard flow: (on|off)$/);
  await expect(page.getByTestId("flag-state-level-status")).toHaveText(/^State-level status: (on|off)$/);
  await expect(page.getByTestId("flag-pipeline-smoke")).toHaveCount(0);
  await expect(page.getByTestId("context-log")).toBeVisible();
  await expect(page.getByTestId("context-log")).toHaveText(
    /Context log: (unavailable|no entries|\d+ recent entr(y|ies))/,
  );
});

test("greeting is the product database value @smoke", async ({ page }) => {
  test.skip(!hasProductDb, "product DB env not set");
  await page.goto("/status");
  await expect(page.getByTestId("greeting")).toHaveText("Hello, VBT");
});

// The Playwright web server runs `next build` first, so the client bundle exists here.
// It also must not hold the Flags secrets: FLAGS_SECRET (real, or the throwaway one playwright.config.ts
// makes for a local run) and the FLAGS SDK key when one is set.
test("client bundle holds nothing from the server-only modules or the Flags secrets @smoke", async () => {
  test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local build; PLAYWRIGHT_BASE_URL targets a deployed app");
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = join(import.meta.dirname, "..", ".next", "static");
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((f) => f.isFile());
  expect(files.length).toBeGreaterThan(0);
  const secrets = [process.env.FLAGS_SECRET, process.env.FLAGS].filter((v): v is string => !!v);
  expect(secrets.length, "FLAGS_SECRET is set for a local run").toBeGreaterThan(0);
  // The official login form ships the Supabase browser client, whose signInWithPassword posts to
  // `${url}/token?grant_type=password`; only the context log's own `/auth/v1/token?grant_type=password` call is server-only.
  for (const f of files) {
    const source = readFileSync(join(f.parentPath, f.name), "utf8");
    expect(source, f.name).not.toMatch(/CONTEXT_|search_context|auth\/v1\/token\?grant_type=password|app_info|official_roles|ballot_public|ballot_event_public|stage_records/);
    // A boolean, not toContain, so a failure never prints the secret.
    for (const secret of secrets) expect(source.includes(secret), `${f.name} holds a Flags secret`).toBe(false);
  }
});
