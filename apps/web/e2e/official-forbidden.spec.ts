import { expect, test } from "@playwright/test";

// T-09 AC2 against the built app: signed out, the official pages and the official endpoints refuse.
// In CI there is no Supabase env, so this also proves they fail closed without it.
test("signed out, official pages and endpoints are 403 @smoke", async ({ request }) => {
  for (const path of ["/official", "/official/precinct/18097-001", "/official/county/18097", "/official/upload", "/official/challenges", "/official/mismatches"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(403);
  }
  // POST /api/batches (T-05) parses before it checks the role, since the role check needs the scope
  // (size -> parse -> requireRole), so it gets a well-formed body here.
  const batch = await request.post("/api/batches", {
    data: { scope: "precinct", scope_id: "18097-001", from_status: "CAST", to_status: "TALLIED_PRECINCT" },
    maxRedirects: 0,
  });
  expect(batch.status(), "POST /api/batches").toBe(403);
  expect(await batch.json()).toEqual({ error: "forbidden" });
  // POST /api/events (T-05) reads the county from the uploaded file before the role check; without a
  // valid file it refuses with 400 and writes nothing. Its 403 path is covered by its route tests.
  const upload = await request.post("/api/events", { maxRedirects: 0 });
  expect(upload.status(), "POST /api/events").toBe(400);
  for (const [method, path] of [
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
