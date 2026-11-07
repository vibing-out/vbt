// Spec AC3: a committed results file shows p95 < 500 ms on both endpoints at the tested rate,
// error rate < 1% and 429 rate < 5%. No run has happened yet (the endpoints don't exist), so until a
// results file is committed this suite reports a todo instead of passing on nothing.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENDPOINTS, MAX_ERROR_RATE, MAX_RATE_LIMITED, P95_BUDGET_MS } from "./config.ts";
import type { LoadResults } from "./summarize.ts";

const dir = new URL("./results/", import.meta.url);
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)) : [];

it.todo("commit tests/load/results/<date>.json from a k6 run (blocked until /api/track and /api/record exist)");

describe.skipIf(files.length === 0).each(files)("results/%s", (file) => {
  const results = JSON.parse(readFileSync(new URL(file, dir), "utf8")) as LoadResults;

  it("is named after its run date and passed its thresholds", () => {
    expect(file).toBe(`${results.runDate}.json`);
    expect(results.thresholdsPassed).toBe(true);
    expect(results.tested.trackRatePerSecond).toBeGreaterThan(0);
  });

  it.each(ENDPOINTS)("%s: p95 under budget, few errors, few 429s", (endpoint) => {
    const r = results.endpoints[endpoint];
    expect(r.requests).toBeGreaterThan(0);
    expect(r.p95Ms).not.toBeNull();
    expect(r.p95Ms!).toBeLessThan(P95_BUDGET_MS);
    expect(r.errorRate!).toBeLessThan(MAX_ERROR_RATE);
    expect(r.rateLimitedRate!).toBeLessThan(MAX_RATE_LIMITED);
  });
});
