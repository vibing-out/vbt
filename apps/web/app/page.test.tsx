import { renderToStaticMarkup } from "react-dom/server";
import { tokens } from "@vbt/ui";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  demoFlags: vi.fn(async () => ({ mismatchView: true, challengeDiscardFlow: true, stateLevelStatus: true })),
  greeting: vi.fn(async (): Promise<string | null> => "Hello, VBT"),
  count: vi.fn(async (): Promise<number | null> => 4),
}));
vi.mock("../lib/demo-flags", () => ({ getDemoFlags: mocks.demoFlags }));
vi.mock("../lib/product-db", () => ({ readGreeting: mocks.greeting }));
vi.mock("../lib/context-log", () => ({ countContextEntries: mocks.count }));

const { default: Home } = await import("./page");
const render = async () => renderToStaticMarkup(await Home());

beforeEach(() => vi.clearAllMocks());

test("shows the greeting read from the product database", async () => {
  expect(await render()).toContain('<p data-testid="greeting">Hello, VBT</p>');
  expect(mocks.greeting).toHaveBeenCalledOnce();
});

test("uses design tokens from @vbt/ui", async () => {
  const html = await render();
  expect(html).toContain(`color:${tokens.color.accent}`);
  expect(html).toContain(`padding:${tokens.space.lg}`);
});

const demoRegions = [
  ["flag-mismatch-view", "Mismatch view", "mismatchView"],
  ["flag-challenge-discard-flow", "Challenge and discard flow", "challengeDiscardFlow"],
  ["flag-state-level-status", "State-level status", "stateLevelStatus"],
] as const;
const region = (testId: string, text: string) => `<p data-testid="${testId}">${text}</p>`;

test("shows each demo flag as on when all are on", async () => {
  const html = await render();
  expect(html).toContain('data-testid="demo-features"');
  for (const [testId, label] of demoRegions) expect(html).toContain(region(testId, `${label}: on`));
  expect(mocks.demoFlags).toHaveBeenCalledOnce();
});

test.each(demoRegions)("shows %s as off when only that flag is off", async (testId, label, field) => {
  mocks.demoFlags.mockResolvedValueOnce({
    mismatchView: true,
    challengeDiscardFlow: true,
    stateLevelStatus: true,
    [field]: false,
  });
  const html = await render();
  expect(html).toContain(region(testId, `${label}: off`));
  for (const [otherId, otherLabel] of demoRegions.filter(([id]) => id !== testId)) {
    expect(html).toContain(region(otherId, `${otherLabel}: on`));
  }
});

test("the pipeline-smoke flag is gone", async () => {
  const html = await render();
  expect(html).not.toContain("flag-pipeline-smoke");
  expect(html).not.toContain("pipeline-smoke");
});

test("demo regions show no time or sequence", async () => {
  const html = await render();
  for (const [testId] of demoRegions) {
    const text = html.match(new RegExp(`data-testid="${testId}">([^<]*)<`))?.[1];
    expect(text, testId).toMatch(/^[A-Za-z -]+: (on|off)$/);
  }
});

test("renders the context-log count, or a stable empty region", async () => {
  expect(await render()).toMatch(/data-testid="context-log"[^>]*>Context log: 4 recent entries</);
  mocks.count.mockResolvedValueOnce(1);
  expect(await render()).toMatch(/data-testid="context-log"[^>]*>Context log: 1 recent entry</);
  mocks.count.mockResolvedValueOnce(0);
  expect(await render()).toMatch(/data-testid="context-log"[^>]*>Context log: no entries</);
});

test("a failed context-log read is shown as unavailable, not as an empty log", async () => {
  mocks.count.mockResolvedValueOnce(null);
  mocks.greeting.mockResolvedValueOnce(null);
  const html = await render();
  expect(html).toMatch(/data-testid="context-log"[^>]*>Context log: unavailable</);
  expect(html).not.toContain("Context log: no entries");
  expect(html).toContain('data-testid="greeting">Greeting unavailable');
});
