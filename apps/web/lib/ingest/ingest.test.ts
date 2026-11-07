import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { IngestError, MAX_FILE_BYTES, parseUpload } from "./index";

// AC6 (T-09): uploads parse epic/4's simulator output shapes (CDF event log and TotalsFile).
const FIXTURES = join(import.meta.dirname, "__fixtures__");
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("machine logs (CDF ElectionEventLog)", () => {
  test("counts successful vote-cast events per device and fingerprints the file", () => {
    const bytes = fixture("cdf-M-18097-001-A.json");
    const parsed = parseUpload("machine_log", "18097-001", bytes);
    expect(parsed.kind).toBe("machine_log");
    if (parsed.kind !== "machine_log") return;
    expect([...parsed.log.counts]).toEqual([["M-18097-001-A", 17]]);
    expect(parsed.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    const short = parseUpload("machine_log", "18097-001", fixture("cdf-M-18097-001-A-short.json"));
    expect(short.kind === "machine_log" && short.log.counts.get("M-18097-001-A")).toBe(16);
  });

  test("failed or other events are not counted", () => {
    const log = {
      ElectionEventLog: {
        GeneratedTime: "x",
        Device: [{ Id: "M", Event: [{ Id: "vote-cast", Disposition: "failure" }, { Id: "polls-opened", Disposition: "success" }, { Id: "vote-cast", Disposition: "success" }] }],
      },
    };
    const parsed = parseUpload("machine_log", "p", json(log));
    expect(parsed.kind === "machine_log" && parsed.log.counts.get("M")).toBe(1);
  });

  test.each([
    ["not JSON", new TextEncoder().encode("{")],
    ["no log", json({})],
    ["no devices", json({ ElectionEventLog: { Device: [] } })],
    ["a device without Id", json({ ElectionEventLog: { Device: [{ Event: [] }] } })],
    ["a device twice", json({ ElectionEventLog: { Device: [{ Id: "M", Event: [] }, { Id: "M", Event: [] }] } })],
    ["no Event list", json({ ElectionEventLog: { Device: [{ Id: "M" }] } })],
    ["an event without Disposition", json({ ElectionEventLog: { Device: [{ Id: "M", Event: [{ Id: "vote-cast" }] }] } })],
    ["a device that is not an object", json({ ElectionEventLog: { Device: ["M"] } })],
  ])("rejects %s", (_name, bytes) => {
    expect(() => parseUpload("machine_log", "18097-001", bytes)).toThrow(IngestError);
  });
});

describe("totals files (TotalsFile)", () => {
  test.each([
    ["precinct_totals", "18097-001", "totals-precinct-18097-001.json", 17],
    ["county_totals", "18097", "totals-county-18097.json", 34],
    ["certified_totals", "18097", "totals-certified-18097.json", 34],
  ] as const)("%s parses with its ballot count, votes and contest list", (kind, scopeId, file, count) => {
    const parsed = parseUpload(kind, scopeId, fixture(file));
    if (parsed.kind === "machine_log") throw new Error("wrong kind");
    expect(parsed.totals.totals.ballotCount).toBe(count);
    expect(parsed.totals.totals.contests["contest-president"]?.["cand-a"]).toBe((count / 17) * 6);
    expect(parsed.totals.manifest.contests.map((c) => c.id)).toEqual(["contest-president", "contest-measure-1"]);
  });

  test("a totals file for another scope or kind is refused", () => {
    expect(() => parseUpload("precinct_totals", "18097-002", fixture("totals-precinct-18097-001.json"))).toThrow(/18097-002/);
    expect(() => parseUpload("certified_totals", "18097", fixture("totals-county-18097.json"))).toThrow(/county-certified/);
  });

  const good = { scope: "precinct", scopeId: "p", electionId: "e", ballotCount: 1, contests: [{ contestId: "c", selections: [{ selectionId: "s", votes: 1 }] }] };
  test.each([
    ["not an object", []],
    ["an unknown scope", { ...good, scope: "district" }],
    ["no scopeId", { ...good, scopeId: "" }],
    ["no electionId", { ...good, electionId: 4 }],
    ["a negative count", { ...good, ballotCount: -1 }],
    ["contests not a list", { ...good, contests: {} }],
    ["a contest without selections", { ...good, contests: [{ contestId: "c" }] }],
    ["a duplicate contest", { ...good, contests: [good.contests[0], good.contests[0]] }],
    ["fractional votes", { ...good, contests: [{ contestId: "c", selections: [{ selectionId: "s", votes: 0.5 }] }] }],
    ["a duplicate selection", { ...good, contests: [{ contestId: "c", selections: [{ selectionId: "s", votes: 1 }, { selectionId: "s", votes: 1 }] }] }],
  ])("rejects %s", (_name, value) => {
    expect(() => parseUpload("precinct_totals", "p", json(value))).toThrow(IngestError);
  });

  test("a __proto__ contest id is plain data", () => {
    const parsed = parseUpload("precinct_totals", "p", json({ ...good, contests: [{ contestId: "__proto__", selections: [{ selectionId: "s", votes: 2 }] }] }));
    if (parsed.kind === "machine_log") throw new Error("wrong kind");
    expect(Object.hasOwn(parsed.totals.totals.contests, "__proto__")).toBe(true);
  });
});

test("files over 1 MB are refused before parsing", () => {
  expect(() => parseUpload("machine_log", "p", new Uint8Array(MAX_FILE_BYTES + 1))).toThrow(/at most/);
});
