import { expect, test } from "@playwright/test";

// When the product database env is set (preview, local with .env.local), the greeting must be the
// real database value. In CI without it, the page must still render the same structure.
const hasProductDb = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

test("home page renders greeting, flag and context-log region @smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "VBT" })).toBeVisible();

  const greeting = page.getByTestId("greeting");
  await expect(greeting).toBeVisible();
  if (hasProductDb) await expect(greeting).toHaveText("Hello, VBT");

  await expect(page.getByTestId("flag-pipeline-smoke")).toBeVisible();
  await expect(page.getByTestId("flag-pipeline-smoke")).toHaveText(/pipeline-smoke flag: (on|off)/);
  await expect(page.getByTestId("context-log")).toBeVisible();
  await expect(page.getByTestId("context-log")).toHaveText(/Context log: (no entries|\d+ recent entr(y|ies))/);
});

// The Playwright web server runs `next build` first, so the client bundle exists here.
test("client bundle holds nothing from the server-only database modules @smoke", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = join(import.meta.dirname, "..", ".next", "static");
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((f) => f.isFile());
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const source = readFileSync(join(f.parentPath, f.name), "utf8");
    expect(source, f.name).not.toMatch(/CONTEXT_|search_context|grant_type=password|app_info/);
  }
});
