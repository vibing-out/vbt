import { expect, test } from "@playwright/test";

const CODES = [
  "BACHELOR-RANDOM-ERTX-CATEGORY",
  "TICKET-MULTIPLY-01EV-HALF",
  "DEFINE-OBVIOUS-9NT5-SIEGE",
  "GENERAL-VIRTUAL-DVCM-MOUNTAIN",
];

test("the judge sheet shows the four demo receipts, each with a QR code @smoke", async ({ page }) => {
  await page.goto("/track/demo-receipts");
  const sheet = page.getByTestId("demo-sheet");
  await expect(sheet.getByTestId("receipt-qr").locator("svg")).toHaveCount(4);
  for (const code of CODES) await expect(sheet).toContainText(code);
});

test("the tracker offers receipt scanning beside the typed code @smoke", async ({ page }) => {
  await page.goto("/track");
  await expect(page.getByRole("button", { name: "Scan your receipt" })).toBeVisible();
  await expect(page.getByLabel("Tracking code")).toBeVisible();
});
