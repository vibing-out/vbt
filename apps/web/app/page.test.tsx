import { renderToStaticMarkup } from "react-dom/server";
import { tokens } from "@vbt/ui";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  smoke: vi.fn(async () => true),
  greeting: vi.fn(async (): Promise<string | null> => "Hello, VBT"),
  count: vi.fn(async (): Promise<number | null> => 4),
}));
vi.mock("../flags", () => ({ pipelineSmoke: mocks.smoke }));
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

test("keeps the pipeline-smoke flag display", async () => {
  expect(await render()).toContain('data-testid="flag-pipeline-smoke">pipeline-smoke flag: on</p>');
  mocks.smoke.mockResolvedValueOnce(false);
  expect(await render()).toContain("pipeline-smoke flag: off");
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
