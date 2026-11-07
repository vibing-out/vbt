// Spec AC4: the load test only reads the public lookup endpoints, with GET.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENDPOINTS, NAME_TAGS, pathFor, RECORD_PATHS, SEED_CODES, TRACK_PATHS } from "./config.ts";

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
      const paths = endpoint === "track" ? TRACK_PATHS : RECORD_PATHS;
      for (const i of [0, 1, 2, 49, 50, 51, 1_000_003, -1]) expect(paths).toContain(pathFor(endpoint, i));
    }
  });

  it("uses the 50 synthetic seed codes", () => {
    expect(SEED_CODES).toHaveLength(50);
    expect(new Set(TRACK_PATHS).size).toBe(50);
    expect(SEED_CODES[0]).toBe("SEED-0001");
    expect(SEED_CODES[49]).toBe("SEED-0050");
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
