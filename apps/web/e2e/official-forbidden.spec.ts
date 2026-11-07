import { expect, test } from "@playwright/test";

// T-09 AC2 against the built app: signed out, the official pages and every T-09 endpoint answer 403.
// In CI there is no Supabase env, so this also proves they fail closed without it.
test("signed out, official pages and endpoints are 403 @smoke", async ({ request }) => {
  for (const path of ["/official", "/official/precinct/18097-001", "/official/county/18097", "/official/upload", "/official/challenges", "/official/mismatches"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(403);
  }
  for (const [method, path] of [
    ["POST", "/api/batches?precinct=18097-001"],
    ["POST", "/api/events?precinct=18097-001"],
    ["POST", "/api/challenges/00000000-0000-4000-8000-000000000000/resolve"],
    ["GET", "/api/reports/mismatches?county=18097"],
  ] as const) {
    const response = await request.fetch(path, { method, maxRedirects: 0 });
    expect(response.status(), `${method} ${path}`).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  }
});

test("the sign-in page is public @smoke", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Official sign-in" })).toBeVisible();
});
