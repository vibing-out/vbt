import { publicLabel } from "@vbt/domain";
import { describe, expect, test } from "vitest";
import { LABELS } from "./labels.ts";
import { seedSet } from "./seed.ts";
import { stubWorld } from "./stubs.ts";
import { fakeClock, seededWorld } from "./testing.ts";
import { unwiredReceipts, unwiredSimulator } from "./unwired.ts";

const decode = (bytes: string | Uint8Array) => (typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes));
// A clock time such as 7:05 or 19:42:10 (dates like 2026-11-03 are fine).
const TIME_OF_DAY = /\b\d{1,2}:\d{2}\b/;

describe("demo seed: a set of 5 Cast and sealed ballots (AC 1)", () => {
  test("inserts one named precinct in its own county and one machine", async () => {
    const { world, seed } = await seededWorld(fakeClock());
    expect(seed.setId).toMatch(/^demo-[a-z2-7]{6}$/);
    expect([...world.precincts]).toEqual([[`${seed.setId}-p`, { county_id: `${seed.setId}-c`, name: `Judges' demo ${seed.setId} (precinct)` }]]);
    expect([...world.machines]).toEqual([[`${seed.setId}-m1`, { precinct_id: `${seed.setId}-p` }]]);
    expect(seed).toMatchObject({ precinctId: `${seed.setId}-p`, countyId: `${seed.setId}-c` });
  });

  test("casts through one simulator export uploaded with POST /api/events", async () => {
    const { world, seed } = await seededWorld(fakeClock());
    const uploads = world.calls().filter((c) => c.method === "uploadEventsFile");
    expect(uploads).toHaveLength(1);
    expect(JSON.parse((uploads[0]!.args[0] as { body: string }).body)).toMatchObject({ kind: "cast", precinctId: seed.precinctId, count: 5 });
    expect(world.calls().map((c) => c.method).filter((m) => m === "createBatch" || m === "resolveChallenge")).toEqual([]);
  });

  test("leaves exactly 5 ballots, all CAST, and the tracker shows Cast and sealed for each", async () => {
    const { world, seed } = await seededWorld(fakeClock());
    const rows = await world.api.readSet(seed.precinctId);
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(["CAST"]));
    for (const b of seed.ballots) {
      const view = await world.api.readTrack(b.trackingCode);
      expect(publicLabel(view.status)).toBe("Cast and sealed");
    }
    expect(seed.ballots.map((b) => b.label)).toEqual([...LABELS]);
  });

  test("two seeds make two separate sets", async () => {
    const world = stubWorld(fakeClock());
    const one = await seedSet(world);
    const two = await seedSet(world);
    expect(one.setId).not.toBe(two.setId);
    expect(one.countyId).not.toBe(two.countyId);
  });

  test("refuses before writing anything when the simulator or receipts aren't wired", async () => {
    for (const missing of [{ simulator: unwiredSimulator() }, { receipts: unwiredReceipts() }]) {
      const world = stubWorld(fakeClock());
      await expect(seedSet({ ...world, ...missing })).rejects.toThrow(/not wired yet.*nothing was written/);
      expect(world.calls()).toEqual([]);
      expect(world.precincts.size + world.machines.size + world.files.size).toBe(0);
    }
  });
});

describe("demo seed: receipts and paper ballot records (AC 2)", () => {
  test("one receipt per ballot whose QR URL opens https://www.ballottrack.org/track/<code>", async () => {
    const { world, seed } = await seededWorld(fakeClock());
    expect(world.receiptCalls).toHaveLength(5);
    for (const b of seed.ballots) {
      expect(b.url).toBe(`https://www.ballottrack.org/track/${b.trackingCode}`);
      expect(world.receiptCalls).toContainEqual(expect.objectContaining({ trackingCode: b.trackingCode, url: b.url, baseUrl: "https://www.ballottrack.org" }));
    }
  });

  test("writes 5 receipts, 5 paper ballot records and index.md in the set's directory", async () => {
    const { world, seed } = await seededWorld(fakeClock());
    const paths = [...world.files.keys()];
    expect(paths.every((p) => p.startsWith(`${seed.setId}/`))).toBe(true);
    expect(paths.filter((p) => /\/receipts\/[A-F0-9-]+\.pdf$/.test(p))).toHaveLength(5);
    expect(paths.filter((p) => /\/paper-ballots\/[a-f0-9]{16}\.pdf$/.test(p))).toHaveLength(5);
    expect(paths).toContain(`${seed.setId}/index.md`);
    // Paper ballot records aren't named by tracking code, so the files don't pair receipt and choices.
    for (const b of seed.ballots) expect(paths.filter((p) => p.includes(b.trackingCode))).toEqual([`${seed.setId}/${b.receiptFile}`]);
  });

  test("no receipt carries a label, a time of day or choices; nothing printed carries a time of day", async () => {
    const { world } = await seededWorld(fakeClock());
    for (const spec of world.receiptCalls) {
      expect(Object.keys(spec as object).sort()).toEqual(
        ["baseUrl", "castDate", "countyName", "electionDate", "electionName", "precinctId", "precinctName", "trackingCode", "url"].sort(),
      );
    }
    for (const [path, contents] of world.files) {
      const text = decode(contents);
      expect(text, path).not.toMatch(TIME_OF_DAY);
      if (path.includes("/receipts/")) {
        expect(text).not.toMatch(/\b(?:Ballot|label)\s+[A-E]\b/i);
        expect(text).not.toMatch(/cand-|contest-|yes|no\b/);
      }
    }
  });

  test("the cover sheet maps A to E to receipts and links Demo control", async () => {
    const { world, seed } = await seededWorld(fakeClock());
    const index = decode(world.files.get(`${seed.setId}/index.md`)!);
    expect(index).toContain(`https://www.ballottrack.org/official/demo?set=${seed.setId}`);
    expect(index).toContain(`demo run --set ${seed.setId}`);
    for (const b of seed.ballots) expect(index).toContain(`| ${b.label} | \`${b.trackingCode}\` | ${b.url} | ${b.receiptFile} |`);
  });
});
