// Spec AC4: the load test only reads the public lookup endpoints, with GET.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENDPOINTS, NAME_TAGS, pathFor, requestPaths, SEED_CODES, settings } from "./config.ts";

const defaults = requestPaths(settings({}));
const TRACK_PATHS = defaults.track;
const RECORD_PATHS = defaults.record;

describe("request paths", () => {
  it("builds only /api/track/ and /api/record/ paths", () => {
    const all = [...TRACK_PATHS, ...RECORD_PATHS, ...Object.values(NAME_TAGS)];
    expect(all.length).toBeGreaterThan(0);
    for (const path of all) expect(path).toMatch(/^\/api\/(track|record)\//);
    expect(TRACK_PATHS.every((p) => p.startsWith("/api/track/"))).toBe(true);
    expect(RECORD_PATHS.every((p) => /^\/api\/record\/[^/]+\/[^/]+$/.test(p))).toBe(true);
  });

  it("pathFor stays inside each endpoint's paths for any iteration", () => {
    for (const endpoint of ENDPOINTS) {
      for (const i of [0, 1, 2, 49, 50, 51, 1_000_003, -1]) {
        expect(defaults[endpoint]).toContain(pathFor(defaults, endpoint, i));
      }
    }
  });

  it("uses the 50 synthetic seed codes", () => {
    expect(SEED_CODES).toHaveLength(50);
    expect(new Set(TRACK_PATHS).size).toBe(50);
    expect(SEED_CODES[0]).toBe("SEED-0001");
    expect(SEED_CODES[49]).toBe("SEED-0050");
  });

  it("defaults the record paths to TALLIED_PRECINCT for the three seed precincts", () => {
    expect(RECORD_PATHS).toEqual([
      "/api/record/18097-001/TALLIED_PRECINCT",
      "/api/record/18097-002/TALLIED_PRECINCT",
      "/api/record/18057-001/TALLIED_PRECINCT",
    ]);
  });
});

describe("record path template overrides", () => {
  it("takes {scope} from RECORD_SCOPES and {stage} from RECORD_STAGE", () => {
    const paths = requestPaths(settings({ RECORD_SCOPES: " 18097 , 18057 ", RECORD_STAGE: "REPORTED_UNOFFICIAL" }));
    expect(paths.record).toEqual(["/api/record/18097/REPORTED_UNOFFICIAL", "/api/record/18057/REPORTED_UNOFFICIAL"]);
    expect(paths.track).toEqual(TRACK_PATHS);
  });

  it("overrides each independently, keeping the other's default", () => {
    expect(requestPaths(settings({ RECORD_STAGE: "CERTIFIED" })).record).toEqual([
      "/api/record/18097-001/CERTIFIED",
      "/api/record/18097-002/CERTIFIED",
      "/api/record/18057-001/CERTIFIED",
    ]);
    expect(requestPaths(settings({ RECORD_SCOPES: "18097" })).record).toEqual(["/api/record/18097/TALLIED_PRECINCT"]);
  });

  it("URL-encodes override values so each stays one path segment", () => {
    const [path] = requestPaths(settings({ RECORD_SCOPES: "county/18097", RECORD_STAGE: "A B" })).record;
    expect(path).toBe("/api/record/county%2F18097/A%20B");
    expect(path).toMatch(/^\/api\/record\/[^/]+\/[^/]+$/);
  });

  it("round-robins over the overridden paths", () => {
    const paths = requestPaths(settings({ RECORD_SCOPES: "a,b" }));
    expect([0, 1, 2].map((i) => pathFor(paths, "record", i))).toEqual([
      "/api/record/a/TALLIED_PRECINCT",
      "/api/record/b/TALLIED_PRECINCT",
      "/api/record/a/TALLIED_PRECINCT",
    ]);
  });
});

describe("lookup.ts", () => {
  const source = readFileSync(new URL("./lookup.ts", import.meta.url), "utf8");

  it("sends only GET requests", () => {
    expect(source).toMatch(/http\.get\(/);
    expect(source).not.toMatch(/http\.(post|put|patch|del|head|options|request|batch|asyncRequest)\(/);
  });

  it("builds every URL from config.ts paths", () => {
    expect(source).not.toMatch(/["'`]\/api\//);
  });
});
