// Spec AC1: scenarios, thresholds and env overrides.
import { describe, expect, it } from "vitest";
import { baseUrl, buildOptions, isExpectedStatus, isRateLimited, settings } from "./config.ts";

describe("buildOptions defaults", () => {
  const options = buildOptions({});

  it("runs track at 50 req/s and record at 5 req/s, constant-arrival-rate for 5m", () => {
    for (const [name, rate] of [["track", 50], ["record", 5]] as const) {
      expect(options.scenarios[name]).toEqual({
        executor: "constant-arrival-rate",
        rate,
        timeUnit: "1s",
        duration: "5m",
        preAllocatedVUs: 50,
        maxVUs: 150,
        exec: name,
      });
    }
  });

  it("sets the pass criteria as thresholds", () => {
    expect(options.thresholds).toEqual({
      "http_req_duration{endpoint:track,status:200}": ["p(95)<500"],
      "http_req_duration{endpoint:record,status:200}": ["p(95)<500"],
      http_req_failed: ["rate<0.01"],
      rate_limited: ["rate<0.05"],
    });
  });

  it("reports the trend stats the summary needs", () => {
    expect(options.summaryTrendStats).toEqual(expect.arrayContaining(["med", "p(95)", "p(99)"]));
  });

  it("targets a local server by default", () => {
    expect(settings({}).baseUrl).toBe("http://localhost:3000");
  });
});

describe("env overrides", () => {
  it("applies BASE_URL, TRACK_RATE, RECORD_RATE and DURATION", () => {
    const env = { BASE_URL: "http://127.0.0.1:4000/", TRACK_RATE: "120", RECORD_RATE: "12", DURATION: "1m30s" };
    const options = buildOptions(env);
    expect(settings(env).baseUrl).toBe("http://127.0.0.1:4000");
    expect(options.scenarios.track).toMatchObject({ rate: 120, duration: "1m30s" });
    expect(options.scenarios.record).toMatchObject({ rate: 12, duration: "1m30s" });
  });

  it("treats empty values as unset", () => {
    expect(settings({ TRACK_RATE: "", RECORD_RATE: "", DURATION: "" })).toMatchObject({
      trackRate: 50,
      recordRate: 5,
      duration: "5m",
    });
  });

  it.each([
    { TRACK_RATE: "0" },
    { TRACK_RATE: "-5" },
    { RECORD_RATE: "2.5" },
    { RECORD_RATE: "fast" },
    { DURATION: "5" },
    { DURATION: "five minutes" },
    { BASE_URL: "localhost:3000" },
    { BASE_URL: "http://localhost:3000/api" },
  ])("rejects invalid %o", (env) => {
    expect(() => buildOptions(env)).toThrow();
  });

  it.each([
    "https://www.ballottrack.org",
    "https://ballottrack.org",
    "https://vbt-git-epic-4-vvpat.vercel.app",
    "https://abcdefgh.supabase.co",
  ])("refuses to load-test %s", (url) => {
    expect(() => baseUrl({ BASE_URL: url })).toThrow(/not a load-test target/);
  });
});

describe("expected statuses", () => {
  it("counts 2xx, 3xx and 429 as expected and everything else as failed", () => {
    expect([200, 304, 399, 429].every(isExpectedStatus)).toBe(true);
    expect([0, 199, 400, 404, 500, 503].some(isExpectedStatus)).toBe(false);
    expect(isRateLimited(429)).toBe(true);
    expect(isRateLimited(200)).toBe(false);
  });
});
