import { expect, test } from "@playwright/test";

test("the home page opens the tracker, and a demo code shows its stages @smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/track$/);
  await expect(page.getByRole("heading", { name: "Track your ballot" })).toBeVisible();

  await page.getByLabel("Tracking code").fill("bachelor random ertx category");
  await page.getByRole("button", { name: "Track my ballot" }).click();
  await expect(page).toHaveURL(/\/track\/BACHELOR-RANDOM-ERTX-CATEGORY$/);
  await expect(page.getByTestId("status")).toHaveText("Included in certified results");
  await expect(page.getByTestId("integrity")).toContainText("unchanged and included in every published record");
  await expect(page.locator("body")).not.toContainText(/\d{1,2}:\d{2}/);
});

test("an unknown code shows a generic message @smoke", async ({ page }) => {
  await page.goto("/track/NOT-A-REAL-CODE");
  await expect(page.getByTestId("track-unknown")).toContainText("We couldn't find that code");
});
