// Spec AC1: scenarios, thresholds and env overrides.
import { describe, expect, it } from "vitest";
import {
  baseUrl,
  buildOptions,
  DEFAULT_TARGET_DESCRIPTION,
  isExpectedStatus,
  isRateLimited,
  SEED_CODES,
  settings,
} from "./config.ts";

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
        maxVUs: 75,
        exec: name,
      });
    }
  });

  it("caps the run at 150 VUs in total across both scenarios", () => {
    const total = Object.values(options.scenarios).reduce((sum, s) => sum + s.maxVUs, 0);
    expect(total).toBe(150);
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

  it("applies MAX_VUS to each scenario", () => {
    const options = buildOptions({ MAX_VUS: "120" });
    for (const s of Object.values(options.scenarios)) expect(s).toMatchObject({ maxVUs: 120, preAllocatedVUs: 50 });
  });

  it("lowers preAllocatedVUs with a MAX_VUS below it, as k6 requires", () => {
    const options = buildOptions({ MAX_VUS: "20" });
    for (const s of Object.values(options.scenarios)) expect(s).toMatchObject({ maxVUs: 20, preAllocatedVUs: 20 });
  });

  it("treats empty values as unset", () => {
    expect(
      settings({ TRACK_RATE: "", RECORD_RATE: "", DURATION: "", MAX_VUS: "", RECORD_SCOPES: "", RECORD_STAGE: "" }),
    ).toMatchObject({
      trackRate: 50,
      recordRate: 5,
      duration: "5m",
      maxVUs: 75,
      recordTargets: [
        { scope: "18097-001", stage: "TALLIED_PRECINCT" },
        { scope: "18097-002", stage: "TALLIED_PRECINCT" },
        { scope: "18057-001", stage: "TALLIED_PRECINCT" },
      ],
    });
  });

  it.each([
    { TRACK_RATE: "0" },
    { TRACK_RATE: "-5" },
    { RECORD_RATE: "2.5" },
    { RECORD_RATE: "fast" },
    { DURATION: "5" },
    { DURATION: "five minutes" },
    { MAX_VUS: "0" },
    { MAX_VUS: "many" },
    { RECORD_SCOPES: "18097-001,,18057-001" },
    { RECORD_SCOPES: "18097-001, " },
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
    expect([200, 304, 399, 429].every((s) => isExpectedStatus(s))).toBe(true);
    expect([0, 199, 400, 404, 500, 503].some((s) => isExpectedStatus(s))).toBe(false);
    expect(isRateLimited(429)).toBe(true);
    expect(isRateLimited(200)).toBe(false);
  });

  it("expects 404 (or 429) for an unknown code, and counts a 200 or a 5xx there as failed", () => {
    expect([404, 429].every((s) => isExpectedStatus(s, true))).toBe(true);
    expect([200, 304, 400, 500, 503].some((s) => isExpectedStatus(s, true))).toBe(false);
  });
});

describe("tracking codes", () => {
  it("defaults to the seed codes and no unknown codes", () => {
    expect(settings({})).toMatchObject({ trackCodes: SEED_CODES, unknownCodes: [] });
  });

  it("takes TRACK_CODES and UNKNOWN_CODES as trimmed comma-separated lists", () => {
    expect(settings({ TRACK_CODES: " A-1 , B-2 ", UNKNOWN_CODES: "X-9" })).toMatchObject({
      trackCodes: ["A-1", "B-2"],
      unknownCodes: ["X-9"],
    });
  });

  it.each([{ TRACK_CODES: "A-1,,B-2" }, { UNKNOWN_CODES: "X-9, " }, { TRACK_CODES: "A-1", UNKNOWN_CODES: "A-1" }])(
    "rejects %o",
    (env) => expect(() => settings(env)).toThrow(),
  );
});

describe("RECORD_RATE=0", () => {
  const options = buildOptions({ RECORD_RATE: "0", MAX_VUS: "150" });

  it("runs only the track scenario, so MAX_VUS is the whole run's cap", () => {
    expect(Object.keys(options.scenarios)).toEqual(["track"]);
    expect(options.scenarios.track).toMatchObject({ maxVUs: 150 });
  });

  it("drops the record p95 threshold and keeps the rest", () => {
    expect(options.thresholds).toEqual({
      "http_req_duration{endpoint:track,status:200}": ["p(95)<500"],
      http_req_failed: ["rate<0.01"],
      rate_limited: ["rate<0.05"],
    });
  });

  it("still rejects a zero TRACK_RATE", () => {
    expect(() => buildOptions({ TRACK_RATE: "0" })).toThrow();
  });
});

describe("TARGET_DESCRIPTION", () => {
  it("defaults to the local Supabase description and accepts an override", () => {
    expect(settings({}).targetDescription).toBe(DEFAULT_TARGET_DESCRIPTION);
    expect(settings({ TARGET_DESCRIPTION: "  In-memory demo build  " }).targetDescription).toBe("In-memory demo build");
  });

  it.each(["http://localhost:3000", "build on localhost", "server at 127.0.0.1"])("rejects a URL or host: %s", (t) => {
    expect(() => settings({ TARGET_DESCRIPTION: t })).toThrow(/not give its URL/);
  });
});
