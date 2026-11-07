import { devices, expect, type Page, test } from "@playwright/test";

// T-08 public ballot tracker, on a phone-sized screen. Most specs mock GET /api/track/* with page.route,
// so they don't depend on a seeded database; "unknown code" runs against the real route.
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];
test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

const GENERIC = "We couldn't find a ballot with that code. Check the code on your receipt and try again.";
type Status = "CAST" | "TALLIED_PRECINCT" | "REPORTED_UNOFFICIAL" | "CERTIFIED" | "CHALLENGED" | "DISCARDED" | "SPOILED";
const LABELS: Record<Status, string> = {
  CAST: "Cast and sealed",
  TALLIED_PRECINCT: "Counted at precinct",
  REPORTED_UNOFFICIAL: "Included in election-night results",
  CERTIFIED: "Included in certified results",
  CHALLENGED: "Under review",
  DISCARDED: "Not counted (reason shown)",
  SPOILED: "Spoiled by voter to check the machine; not counted",
};
const PUBLISHED: Status[] = ["TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "CERTIFIED"];

function body(path: Status[], check: "passed" | "unavailable" = "passed") {
  const status = path.at(-1)!;
  return {
    trackingCode: "SEED-0001",
    status,
    label: LABELS[status],
    terminal: ["CERTIFIED", "DISCARDED", "SPOILED"].includes(status),
    ciphertextHash: "9c56cc51b374c3ba189210d5b6d4bf57790d351c96c47c02190ecf1e430635ab",
    castDate: "2026-11-03",
    precinct: { id: "18097-001", name: "Center 1", countyId: "18097" },
    timeline: path.map((s, i) => ({ status: s, label: LABELS[s], date: i === 0 ? "2026-11-03" : "2026-11-04", reason: null })),
    stages: path
      .filter((s) => PUBLISHED.includes(s))
      .map((s) => ({
        stage: s,
        scope: s === "TALLIED_PRECINCT" ? "precinct" : "county",
        scopeId: s === "TALLIED_PRECINCT" ? "18097-001" : "18097",
        merkleRoot: "4f1c",
        signature: "c2ln",
        publishedOn: "2026-11-04",
        recordUrl: null,
        check: { state: check, proof: null },
      })),
  };
}

/** Mock the API with a body that can be swapped mid-test; counts requests. */
async function mockApi(page: Page, initial: object) {
  const state = { body: initial, requests: 0 };
  await page.route("**/api/track/**", (route) => {
    state.requests++;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.body) });
  });
  return state;
}

test("valid code shows status, dated stages and passing inclusion checks @smoke", async ({ page }) => {
  await mockApi(page, body(["CAST", "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "CERTIFIED"]));
  await page.goto("/track/SEED-0001");
  await expect(page.getByTestId("current-status")).toHaveText("Included in certified results");
  const entries = page.getByTestId("timeline-entry");
  await expect(entries).toHaveCount(4);
  for (const [i, s] of (["CAST", "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "CERTIFIED"] as const).entries()) {
    await expect(entries.nth(i)).toContainText(LABELS[s]);
    await expect(entries.nth(i)).toContainText(i === 0 ? "November 3, 2026" : "November 4, 2026");
  }
  await expect(page.getByTestId("stage-check")).toHaveCount(3);
  for (const check of await page.getByTestId("stage-check").all()) {
    await expect(check).toContainText("Unchanged and included in this stage's public record");
  }
  await expect(page.getByTestId("ciphertext")).toContainText("Encrypted ballot recorded");
  await expect(page.getByText("It does not show how you voted.")).toBeVisible();
});

test("unknown code shows the generic message @smoke", async ({ page, request }) => {
  // The real route: unknown and no-database both give the same 404, so this holds with or without env.
  const response = await request.get("/api/track/ZZZZ-0000-UNKNOWN");
  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found", message: GENERIC });

  await page.goto("/track/ZZZZ-0000-UNKNOWN");
  await expect(page.getByTestId("not-found")).toHaveText(GENERIC);
  await expect(page.getByTestId("current-status")).toHaveCount(0);
});

test("stage change appears on the open page within 3 seconds @smoke", async ({ page }) => {
  const api = await mockApi(page, body(["CAST"]));
  await page.goto("/track/SEED-0001");
  await expect(page.getByTestId("current-status")).toHaveText("Cast and sealed");
  api.body = body(["CAST", "TALLIED_PRECINCT"]);
  const changed = Date.now();
  await expect(page.getByTestId("current-status")).toHaveText("Counted at precinct", { timeout: 3000 });
  expect(Date.now() - changed).toBeLessThan(3000);
  await expect(page.getByText("Counted at Center 1.")).toBeVisible();
});

test("page never shows a cast time or any choice @smoke", async ({ page }) => {
  await mockApi(page, body(["CAST", "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL"]));
  await page.goto("/track/SEED-0001");
  await expect(page.getByTestId("current-status")).toHaveText("Included in election-night results");
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\d{1,2}:\d{2}/);
  expect(text).not.toMatch(/\b(AM|PM)\b/);
  expect(text).not.toMatch(/voted for|choice|candidate|contest/i);
});

test("polling stops on a terminal stage @smoke", async ({ page }) => {
  const api = await mockApi(page, body(["CAST", "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "CERTIFIED"]));
  await page.goto("/track/SEED-0001");
  await expect(page.getByTestId("current-status")).toHaveText("Included in certified results");
  const seen = api.requests;
  await page.waitForTimeout(6000);
  expect(api.requests).toBe(seen);
});

test("unavailable checks never show as passed @smoke", async ({ page }) => {
  await mockApi(page, body(["CAST", "TALLIED_PRECINCT"], "unavailable"));
  await page.goto("/track/SEED-0001");
  await expect(page.getByTestId("stage-check")).toHaveText(/Check not yet available/);
  await expect(page.getByText("Unchanged and included")).toHaveCount(0);
});

test("manual entry and /track?code= open the tracking page @smoke", async ({ page }) => {
  await mockApi(page, body(["CAST"]));
  await page.goto("/track");
  await page.getByLabel("Tracking code").fill("seed 0001");
  await page.getByRole("button", { name: "Track ballot" }).click();
  await expect(page).toHaveURL(/\/track\/SEED-0001$/);
  await expect(page.getByTestId("current-status")).toHaveText("Cast and sealed");

  await page.goto("/track?code=seed-0001");
  await expect(page).toHaveURL(/\/track\/SEED-0001$/);
});

test("no sign-up, email or phone fields @smoke", async ({ page }) => {
  await mockApi(page, body(["CAST"]));
  for (const path of ["/track", "/track/SEED-0001"]) {
    await page.goto(path);
    await expect(page.locator('input[type="email"], input[type="tel"], input[type="password"]')).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(/e-?mail|phone|sign[ -]?up|create an account/i);
  }
  await page.goto("/track");
  await expect(page.locator("input, textarea, select")).toHaveCount(1);
});

test("/ opens the tracker, and a demo code works through the real route @smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/track$/);
  await page.getByLabel("Tracking code").fill("bachelor random ertx category");
  await page.getByRole("button", { name: "Track ballot" }).click();
  await expect(page).toHaveURL(/\/track\/BACHELOR-RANDOM-ERTX-CATEGORY$/);
  await expect(page.getByTestId("current-status")).toHaveText("Included in certified results");
  await expect(page.getByTestId("stage-check")).toHaveCount(3);
  await page.getByRole("link", { name: "View the paper receipt" }).click();
  await expect(page).toHaveURL(/\/receipt\/BACHELOR-RANDOM-ERTX-CATEGORY$/);
  await expect(page.getByTestId("receipt-qr").locator("svg")).toBeVisible();
});
