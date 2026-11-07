import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// T-08b: the tracker's stage links and the public /record page. The tracker specs mock GET /api/track/*
// with page.route. /record is rendered on the server from the database, so with no database env (ticket
// CI) it shows its empty state, and the download checks are reported as skipped, not passed silently.
const STAGES = [
  { stage: "TALLIED_PRECINCT", label: "Counted at precinct", scope: "precinct", scopeId: "18097-001" },
  { stage: "REPORTED_UNOFFICIAL", label: "Included in election-night results", scope: "county", scopeId: "18097" },
  { stage: "CERTIFIED", label: "Included in certified results", scope: "county", scopeId: "18097" },
] as const;

const trackBody = {
  trackingCode: "SEED-0001",
  status: "CERTIFIED",
  label: "Included in certified results",
  terminal: true,
  ciphertextHash: "9c56cc51b374c3ba189210d5b6d4bf57790d351c96c47c02190ecf1e430635ab",
  castDate: "2026-11-03",
  precinct: { id: "18097-001", name: "Center 1", countyId: "18097" },
  timeline: [
    { status: "CAST", label: "Cast and sealed", date: "2026-11-03", reason: null },
    ...STAGES.map((s) => ({ status: s.stage, label: s.label, date: "2026-11-04", reason: null })),
  ],
  stages: STAGES.map((s) => ({
    stage: s.stage,
    scope: s.scope,
    scopeId: s.scopeId,
    merkleRoot: "4f1c",
    signature: "c2ln",
    publishedOn: "2026-11-04",
    recordUrl: `/record#record-${s.scopeId}-${s.stage}`,
    check: { state: "unavailable", proof: null },
  })),
};

test("each stage on the tracker links to its published record on /record @smoke", async ({ page }) => {
  await page.route("**/api/track/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(trackBody) }),
  );
  await page.goto("/track/SEED-0001");
  const links = page.getByTestId("stage-check").getByRole("link", { name: "View the published record" });
  await expect(links).toHaveCount(3);
  for (const [i, s] of STAGES.entries()) {
    await expect(links.nth(i)).toHaveAttribute("href", `/record#record-${s.scopeId}-${s.stage}`);
  }
  await links.first().click();
  await expect(page).toHaveURL(/\/record#record-18097-001-TALLIED_PRECINCT$/);
  await expect(page.getByRole("heading", { name: "Published records" })).toBeVisible();
});

test("/record lists the published records and links the format doc and the verifier @smoke", async ({ page }) => {
  await page.goto("/record");
  await expect(page.getByRole("heading", { name: "Published records" })).toBeVisible();

  const check = page.getByTestId("check-it-yourself");
  await expect(check.getByRole("heading", { name: "Check it yourself" })).toBeVisible();
  await expect(check.getByRole("link", { name: "How a record is laid out" })).toHaveAttribute("href", /\/docs\/record-format\.md$/);
  await expect(check.getByRole("link", { name: "The independent verifier" })).toHaveAttribute("href", /\/tools\/verifier$/);

  const entries = page.getByTestId("record-entry");
  const count = await entries.count();
  if (count === 0) {
    await expect(page.getByTestId("no-records").or(page.getByTestId("records-unavailable"))).toBeVisible();
  }
  for (const entry of await entries.all()) {
    const scopeId = await entry.getAttribute("data-scope-id");
    const stage = await entry.getAttribute("data-stage");
    await expect(entry).toHaveAttribute("id", `record-${scopeId}-${stage}`);
    await expect(entry.getByTestId("record-download")).toHaveAttribute("href", `/api/record/${scopeId}/${stage}`);
    await expect(entry.getByTestId("merkle-root")).toHaveText(/^[0-9a-f]{64}$/);
    await expect(entry.getByTestId("signature")).toHaveText(/^[0-9a-f]{128}$/);
    await expect(entry.getByTestId("totals")).toBeVisible();
  }

  // Dates only, never a time of day.
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\d{1,2}:\d{2}/);
  expect(text).not.toMatch(/\b(AM|PM)\b/);
});

test("each /record download matches GET /api/record/{scope}/{stage} exactly @smoke", async ({ page, request }) => {
  await page.goto("/record");
  const entries = await page.getByTestId("record-entry").all();
  test.skip(entries.length === 0, "no published records (no database env, or nothing published yet)");

  for (const entry of entries) {
    const link = entry.getByTestId("record-download");
    const href = (await link.getAttribute("href"))!;
    const api = await request.get(href);
    expect(api.status()).toBe(200);
    const body = await api.body();

    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    const saved = await readFile((await download.path())!);
    expect(saved.equals(body)).toBe(true);

    // The page shows the same root and signature the JSON carries.
    const json = JSON.parse(body.toString("utf8")) as { merkle_root: string; signature: string };
    await expect(entry.getByTestId("merkle-root")).toHaveText(json.merkle_root);
    await expect(entry.getByTestId("signature")).toHaveText(json.signature);
  }
});

const hasProductDb = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

test("an unknown stage is a 404 from the real route @smoke", async ({ request }) => {
  // Rejected before any database read, so this holds with or without database env.
  const response = await request.get("/api/record/18097/NOT_A_STAGE");
  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
});

test("an unpublished record is a 404 from the real route @smoke", async ({ request }) => {
  // Without database env the route answers 500 server_misconfigured, so this needs the database.
  test.skip(!hasProductDb, "product DB env not set");
  const response = await request.get("/api/record/no-such-scope/CERTIFIED");
  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
});
