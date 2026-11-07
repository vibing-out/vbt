import { expect, test } from "@playwright/test";
import { demoAdapters, type RunLine, seedSet } from "@vbt/demo";
import { connect, signInAsDemoState } from "@vbt/demo/cli";

// T-22, the judges' live run end to end on a deployed preview: seed a fresh set, open two trackers, start
// the run, watch each stage change, and check a second start is refused. Takes about 3 minutes, so it is
// tagged @demo, outside playwright.config.ts's @smoke grep, and never runs in ticket CI. Run it by hand:
//   PLAYWRIGHT_BASE_URL=<preview> pnpm --filter web exec playwright test --grep @demo e2e/demo-run.spec.ts
// Needs the DEMO_STATE_* secrets, the Supabase env and SUPABASE_SECRET_KEY (all names in .env.example).
// Skipped, not silently passed, while that env or the real simulator and receipts adapters are missing.

const preview = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "");
const NEEDED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "DEMO_STATE_EMAIL",
  "DEMO_STATE_PASSWORD",
  "DEMO_STATE_TOTP_SECRET",
];

test("a judges' run moves every tracker to its final state within 3:10 @demo", async ({ browser, request }) => {
  test.skip(!preview, "PLAYWRIGHT_BASE_URL (a preview deploy) not set");
  test.skip(NEEDED.some((name) => !process.env[name]), "DEMO_STATE_*, SUPABASE_SECRET_KEY or the Supabase env not set");
  const { simulator, receipts } = demoAdapters();
  test.skip(!simulator.available || !receipts.available, "the simulator and receipts adapters are not wired yet (follow-up)");
  test.setTimeout(300_000);

  const { api, registry } = await connect(preview!, process.env, true);
  const sink = { write: async () => {} };
  const seed = await seedSet({ api, simulator, receipts, registry, sink, appBaseUrl: preview! });
  const byLabel = new Map(seed.ballots.map((b) => [b.label, b]));

  // Two judges' tabs, on the preview rather than production.
  const open = async (label: "A" | "E") => {
    const page = await browser.newPage();
    await page.goto(`/track/${encodeURIComponent(byLabel.get(label)!.trackingCode)}`);
    await expect(page.getByText("Cast and sealed")).toBeVisible();
    return page;
  };
  const [pageA, pageE] = await Promise.all([open("A"), open("E")]);

  const auth = `Bearer ${await signInAsDemoState(process.env)}`;
  const started = Date.now();
  const run = request.post(`/api/official/demo/runs?set=${seed.setId}`, { headers: { Authorization: auth }, timeout: 240_000 });

  // Each change must show on an open tracker within 3 s of its step (T-08 polls every 2 s or less).
  const by = (offset: number) => Math.max(1_000, started + (offset + 3) * 1000 - Date.now());
  await expect(pageE.getByText("Under review")).toBeVisible({ timeout: by(45) });
  await expect(pageA.getByText("Counted at precinct")).toBeVisible({ timeout: by(45) });
  await expect(pageA.getByText("Included in election-night results")).toBeVisible({ timeout: by(90) });
  await expect(pageE.getByText("machine record did not match the paper ballot")).toBeVisible({ timeout: by(120) });
  await expect(pageA.getByText("Included in certified results")).toBeVisible({ timeout: by(160) });

  const response = await run;
  expect(response.status()).toBe(200);
  const lines = (await response.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as RunLine);
  expect(lines.at(-1)).toMatchObject({ type: "finished", ok: true, overran: false });
  expect(Date.now() - started).toBeLessThanOrEqual(190_000 + 5_000);

  const again = await request.post(`/api/official/demo/runs?set=${seed.setId}`, { headers: { Authorization: auth } });
  expect(again.status()).toBe(409);
});
