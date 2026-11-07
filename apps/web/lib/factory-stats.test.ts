import { afterEach, expect, test, vi } from "vitest";
import { factoryStats, startOfLocalDay } from "./factory-stats";

afterEach(() => vi.unstubAllGlobals());

const pulls = [
  { merged_at: "2026-11-07T18:00:00Z", head: { ref: "epic/2" } },
  { merged_at: "2026-11-07T19:00:00Z", head: { ref: "epic/3" } },
  { merged_at: null, head: { ref: "epic/4" } },
  { merged_at: "2026-11-07T17:00:00Z", head: { ref: "factory/context-refresh" } },
];

function mockGitHub(counts: Record<string, number>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    void init;
    if (url.includes("/pulls?")) return Response.json(pulls);
    const q = decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
    const key = Object.keys(counts).find((k) => q.includes(k));
    return key ? Response.json({ total_count: counts[key] }) : new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

test("midnight in Indianapolis (UTC-5 in November) is 05:00Z", () => {
  expect(startOfLocalDay(new Date("2026-11-07T20:30:00Z"))).toBe("2026-11-07T05:00:00Z");
  // 02:00Z on Nov 8 is still Nov 7 in Indianapolis.
  expect(startOfLocalDay(new Date("2026-11-08T02:00:00Z"))).toBe("2026-11-07T05:00:00Z");
});

test("reads ticket counts, today's merges and epics merged into main, with no token", async () => {
  const fetchMock = mockGitHub({ "is:closed -label:epic": 31, "is:open -label:epic": 5, "merged:>=2026-11-07T05:00:00Z": 12 });
  expect(await factoryStats(new Date("2026-11-07T20:00:00Z"))).toEqual({
    ticketsClosed: 31,
    ticketsOpen: 5,
    mergedToday: 12,
    epicsMerged: 2,
  });
  for (const [url, init] of fetchMock.mock.calls) {
    expect(url).toMatch(/^https:\/\/api\.github\.com\//);
    expect(decodeURIComponent(url)).toContain("vibing-out/vbt");
    expect(JSON.stringify(init?.headers ?? {})).not.toMatch(/authorization/i);
  }
});

test("a failed call makes only that number null", async () => {
  mockGitHub({ "is:closed -label:epic": 31, "merged:>=": 12 });
  const stats = await factoryStats(new Date("2026-11-07T20:00:00Z"));
  expect(stats).toEqual({ ticketsClosed: 31, ticketsOpen: null, mergedToday: 12, epicsMerged: 2 });
});

test("a network failure gives nulls, never a throw", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
  expect(await factoryStats()).toEqual({ ticketsClosed: null, ticketsOpen: null, mergedToday: null, epicsMerged: null });
});
