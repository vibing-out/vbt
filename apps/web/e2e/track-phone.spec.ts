import { expect, test, type Page } from "@playwright/test";

// Judge-visible /track flows at phone width: all four demo codes, the receipt, and an unknown code.
// The demo codes are read from the "Try a demo ballot" list so the test follows the seed.
test.use({ viewport: { width: 375, height: 812 } });

const NO_TIME_OF_DAY = /\b\d{1,2}:\d{2}\b/;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function demoCodes(page: Page): Promise<string[]> {
  await page.goto("/track");
  const hrefs = await page.locator('a[href^="/track/"]:not([href$="/receipt"])').evaluateAll((as) =>
    as.map((a) => a.getAttribute("href")!),
  );
  return hrefs.map((h) => h.replace("/track/", ""));
}

test("all four demo codes show a result with no time of day and no sideways scroll @smoke", async ({ page }) => {
  const codes = await demoCodes(page);
  expect(codes).toHaveLength(4);
  for (const code of codes) {
    await page.goto(`/track/${code}`);
    await expect(page.getByTestId("current-status")).not.toBeEmpty();
    await expect(page.getByTestId("timeline-entry").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "View the paper receipt" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(NO_TIME_OF_DAY);
    await expectNoHorizontalScroll(page);
  }
});

test("the receipt shows the code and a QR code, and no time of day @smoke", async ({ page }) => {
  const [code] = await demoCodes(page);
  await page.goto(`/track/${code}`);
  await page.getByRole("link", { name: "View the paper receipt" }).click();
  await expect(page).toHaveURL(new RegExp(`/receipt/${code}$`));
  await expect(page.getByRole("heading", { name: "Your paper receipt" })).toBeVisible();
  await expect(page.getByTestId("receipt-qr").locator("svg")).toBeVisible();
  await expect(page.locator("body")).toContainText(code!);
  await expect(page.locator("body")).not.toContainText(NO_TIME_OF_DAY);
  await expectNoHorizontalScroll(page);
  await page.getByRole("link", { name: "Track this ballot" }).click();
  await expect(page).toHaveURL(new RegExp(`/track/${code}$`));
});

test("an unknown code and its receipt show a generic message @smoke", async ({ page }) => {
  await page.goto("/track/NOT-A-REAL-CODE");
  await expect(page.getByTestId("not-found")).toContainText("We couldn't find a ballot with that code");
  await expectNoHorizontalScroll(page);
  // The old receipt address redirects to /receipt/{code}.
  await page.goto("/track/NOT-A-REAL-CODE/receipt");
  await expect(page.getByText("We couldn't find that code")).toBeVisible();
});
