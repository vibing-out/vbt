// Spec AC2: the results object holds only aggregate fields, with no tracking code, URL or time of day.
import { describe, expect, it } from "vitest";
import { summarize, type K6SummaryData } from "./summarize.ts";

const trend = (med: number, p95: number, p99: number) => ({ values: { avg: med, med, "p(95)": p95, "p(99)": p99 } });

// Shaped like k6 handleSummary data, including the identifying details a raw summary can carry.
const fixture: K6SummaryData & Record<string, unknown> = {
  metrics: {
    "http_req_duration{endpoint:track,status:200}": { ...trend(41.234, 180.56, 320.04), thresholds: { "p(95)<500": { ok: true } } },
    "http_req_duration{endpoint:record,status:200}": { ...trend(60, 240.44, 410), thresholds: { "p(95)<500": { ok: true } } },
    "http_req_duration{url:http://localhost:3000/api/track/SEED-0007}": trend(40, 170, 300),
    "http_req_duration{name:http://localhost:3000/api/track/SEED-0042}": trend(40, 170, 300),
    http_req_failed: { values: { rate: 0.002, passes: 33, fails: 16467 }, thresholds: { "rate<0.01": { ok: true } } },
    rate_limited: { values: { rate: 0.01, passes: 165, fails: 16335 }, thresholds: { "rate<0.05": { ok: true } } },
    track_failed: { values: { rate: 0.002, passes: 30, fails: 14970 } },
    record_failed: { values: { rate: 0.002, passes: 3, fails: 1497 } },
    track_rate_limited: { values: { rate: 0.011, passes: 165, fails: 14835 } },
    record_rate_limited: { values: { rate: 0, passes: 0, fails: 1500 } },
  },
  state: { testRunDurationMs: 300012.5, isStdOutTTY: false, startedAt: "2026-11-07T21:14:09.123Z" },
  root_group: { name: "", checks: [{ name: "GET http://localhost:3000/api/track/SEED-0001 at 21:14:09" }] },
  options: { summaryTimeUnit: "ms" },
};

const meta = {
  now: new Date("2026-11-07T21:19:09.456Z"),
  k6Version: "k6 v1.4.2 (commit/abc123, go1.24.4, linux/amd64)",
  trackRate: 50,
  recordRate: 5,
  duration: "5m",
};

describe("summarize", () => {
  const results = summarize(fixture, meta);

  it("keeps per-endpoint aggregates, the k6 version, run date, target and the free-tier note", () => {
    expect(results).toEqual({
      version: 1,
      runDate: "2026-11-07",
      k6Version: "v1.4.2",
      target: expect.stringContaining("local Supabase stack"),
      nastyLimitsEmulated: false,
      tested: { trackRatePerSecond: 50, recordRatePerSecond: 5, duration: "5m" },
      endpoints: {
        track: { requests: 15000, medianMs: 41.2, p95Ms: 180.6, p99Ms: 320, errorRate: 0.002, rateLimitedRate: 0.011 },
        record: { requests: 1500, medianMs: 60, p95Ms: 240.4, p99Ms: 410, errorRate: 0.002, rateLimitedRate: 0 },
      },
      thresholdsPassed: true,
    });
  });

  it("lets no tracking code, URL or time of day through", () => {
    const text = JSON.stringify(results);
    expect(text).not.toMatch(/SEED-/);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(results.runDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("fails the run when any threshold failed", () => {
    const failing = structuredClone(fixture);
    failing.metrics!["rate_limited"]!.thresholds = { "rate<0.05": { ok: false } };
    expect(summarize(failing, meta).thresholdsPassed).toBe(false);
  });

  it("reports missing data as null rather than inventing numbers", () => {
    const empty = summarize({ metrics: {} }, { ...meta, k6Version: undefined });
    expect(empty.k6Version).toBe("unknown");
    expect(empty.thresholdsPassed).toBe(false);
    expect(empty.endpoints.track).toEqual({
      requests: 0,
      medianMs: null,
      p95Ms: null,
      p99Ms: null,
      errorRate: null,
      rateLimitedRate: null,
    });
  });
});
