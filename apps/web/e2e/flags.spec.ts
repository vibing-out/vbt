import { expect, test } from "@playwright/test";
import { encryptOverrides } from "flags";

// Toggle without a redeploy: Flags Explorer sets the encrypted `vercel-flag-overrides` cookie, and the
// server uses it on the next request. This sets the same cookie with the server's FLAGS_SECRET (a local
// run gets a throwaway one from playwright.config.ts) and reloads the running build.
const secret = process.env.FLAGS_SECRET;

const demoFlags = [
  { key: "mismatch-view", label: "Mismatch view" },
  { key: "challenge-discard-flow", label: "Challenge and discard flow" },
  { key: "state-level-status", label: "State-level status" },
];

for (const { key, label } of demoFlags) {
  test(`turning ${key} off in Flags Explorer changes the page without a redeploy @smoke`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(!secret, "PLAYWRIGHT_BASE_URL is set without the deployment's FLAGS_SECRET, so no override cookie can be made");
    await page.goto("/status");
    for (const flag of demoFlags) await expect(page.getByTestId(`flag-${flag.key}`)).toHaveText(`${flag.label}: on`);

    const value = await encryptOverrides({ [key]: false }, secret);
    await context.addCookies([{ name: "vercel-flag-overrides", value, url: baseURL! }]);
    await page.reload();

    await expect(page.getByTestId(`flag-${key}`)).toHaveText(`${label}: off`);
    for (const other of demoFlags.filter((f) => f.key !== key)) {
      await expect(page.getByTestId(`flag-${other.key}`)).toHaveText(`${other.label}: on`);
    }

    // Clearing the override puts the flag back to its default.
    await context.clearCookies({ name: "vercel-flag-overrides" });
    await page.reload();
    await expect(page.getByTestId(`flag-${key}`)).toHaveText(`${label}: on`);
  });
}
