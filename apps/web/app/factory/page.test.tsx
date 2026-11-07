import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { Correction } from "../../lib/context-log";
import type { FactoryStats } from "../../lib/factory-stats";

const mocks = vi.hoisted(() => ({
  stats: vi.fn(
    async (): Promise<FactoryStats> => ({ ticketsClosed: 31, ticketsOpen: 5, mergedToday: 12, epicsMerged: 2 }),
  ),
  corrections: vi.fn(
    async (): Promise<Correction[] | null> => [
      { id: 42, date: "2026-11-07", topic: "T-04", claim: "Wrong cast order", caughtBy: "code reviewer", fix: "Read the view" },
    ],
  ),
}));
vi.mock("../../lib/factory-stats", () => ({ factoryStats: mocks.stats }));
vi.mock("../../lib/context-log", () => ({ recentCorrections: mocks.corrections }));

const page = await import("./page");
const render = async () => renderToStaticMarkup(await page.default());

beforeEach(() => vi.clearAllMocks());

test("caches the rendered page for 60 seconds", () => {
  expect(page.revalidate).toBe(60);
});

test("shows the pipeline from ticket to main, through one review and one fix pass", async () => {
  const html = await render();
  const steps = ["Ticket", "Warp Foreman", "Implement", "One review", "One fix pass", "Required checks", "Epic", "Human approval", "main"];
  let at = html.indexOf('data-testid="pipeline"');
  for (const step of steps) {
    const next = html.indexOf(`${step}</span>`, at);
    expect(next, step).toBeGreaterThan(at);
    at = next;
  }
  expect(html).toContain("check, context-check, CodeQL, Vercel");
});

test("shows the live GitHub numbers", async () => {
  const html = await render();
  expect(html).toMatch(/data-testid="stat-tickets-closed"><span[^>]*>31</);
  expect(html).toMatch(/data-testid="stat-tickets-open"><span[^>]*>5</);
  expect(html).toMatch(/data-testid="stat-merged-today"><span[^>]*>12</);
  expect(html).toMatch(/data-testid="stat-epics-merged"><span[^>]*>2</);
});

test("an unavailable number shows a dash and says so, instead of 0", async () => {
  mocks.stats.mockResolvedValueOnce({ ticketsClosed: null, ticketsOpen: 5, mergedToday: 12, epicsMerged: 2 });
  const html = await render();
  expect(html).toMatch(/data-testid="stat-tickets-closed"><span[^>]*>—</);
  expect(html).toContain("tickets closed (unavailable)");
});

test("lists corrections with the claim, how it was caught and the fix", async () => {
  const html = await render();
  expect(html).toContain("Wrong cast order");
  expect(html).toContain("code reviewer");
  expect(html).toContain("Read the view");
});

test("an unreadable context log is shown as unavailable, distinct from an empty one", async () => {
  mocks.corrections.mockResolvedValueOnce(null);
  expect(await render()).toContain("The context log is unavailable right now.");
  mocks.corrections.mockResolvedValueOnce([]);
  expect(await render()).toContain("No corrections logged yet.");
});

test("labels the cost as Warp's dashboard attribution", async () => {
  const html = await render();
  expect(html).toContain("$4.86");
  expect(html).toContain("$0.86");
  expect(html).toContain("Warp&#x27;s dashboard attribution, measured Nov 7, 2026");
});

test("uses one navy hero card from @vbt/ui", async () => {
  expect((await render()).match(/data-variant="hero"/g)).toHaveLength(1);
});

test("is a server component, so the context-log reader never ships to the browser", () => {
  expect(readFileSync(join(import.meta.dirname, "page.tsx"), "utf8")).not.toMatch(/^\s*["']use client["']/m);
});
