import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVENT_IDS, castBallotIds } from "./formats/cdf-log.ts";
import { cvrPath, machinePath, simulate } from "./generate.ts";
import { listFiles, loadTree, runChecks, treeHashes, type Tree } from "./test/helpers.ts";
import type { CdfLogFile, SimulateOptions } from "./types.ts";
import { validateCdfLog } from "./validate/cdf.ts";
import { validateCvrReport } from "./validate/cvr.ts";
import { canonicalJson, writeOutput } from "./write.ts";

const AC = { ballots: 100, mismatchRate: 0.02, seed: "1", machines: 4, precincts: 2 } satisfies SimulateOptions;

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "vbt-sim-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function run(name: string, options: SimulateOptions): Promise<{ dir: string; tree: Tree }> {
  const dir = join(root, name);
  await writeOutput(dir, simulate(options));
  return { dir, tree: await loadTree(dir) };
}

describe("100-ballot run (AC1)", () => {
  it("writes manifest, one log per machine, exactly 100 CVRs and totals", async () => {
    const { dir, tree } = await run("ac1", AC);
    const files = await listFiles(dir);
    expect(files).toContain("manifest.json");
    for (const m of tree.manifest.machines) expect(files).toContain(machinePath(m.id));
    expect(files.filter((f) => /^cvrs\/.+\.cvr\.json$/.test(f))).toHaveLength(100);
    for (const id of tree.manifest.ballotIds) expect(files).toContain(cvrPath(id));
    expect(files.filter((f) => f.startsWith("totals/"))).toEqual([
      "totals/certified-marion.json",
      "totals/county-marion.json",
      "totals/precinct-pct-01.json",
      "totals/precinct-pct-02.json",
    ]);
    expect(tree.manifest.files).toEqual(files.filter((f) => f !== "manifest.json"));
  });

  it("vote-cast events plus C1 omissions account for every manifest ballot", async () => {
    const { tree } = await run("ac1-sum", { ...AC, mismatchRate: 0.2 });
    const logged = [...tree.logs.values()].flatMap((l) => castBallotIds(l));
    const omitted = tree.manifest.faults.filter((f) => f.failsCheck === "C1").map((f) => f.ballotId);
    expect(omitted.length).toBeGreaterThan(0);
    expect(tree.manifest.ballotIds).toHaveLength(100);
    expect(logged.length + omitted.length).toBe(100);
    expect([...logged, ...omitted].sort()).toEqual([...tree.manifest.ballotIds].sort());
  });
});

describe("written CDF logs (AC2)", () => {
  it("every vx-logs.cdf.json has the CDF structure", async () => {
    const { tree } = await run("ac2", AC);
    expect(tree.logs.size).toBe(4);
    for (const log of tree.logs.values()) {
      expect(validateCdfLog(log)).toEqual([]);
      expect(typeof log.ElectionEventLog.GeneratedTime).toBe("string");
      for (const d of log.ElectionEventLog.Device) {
        expect(Object.keys(d)).toEqual(expect.arrayContaining(["Type", "Id", "Version", "Event"]));
        for (const e of d.Event) expect(Object.keys(e)).toEqual(expect.arrayContaining(["Id", "Disposition", "Sequence", "TimeStamp"]));
      }
    }
  });

  it("required events appear in order on machines without a C1 fault", async () => {
    const { tree } = await run("ac2-order", { ...AC, mismatchRate: 0 });
    for (const m of tree.manifest.machines) {
      const onMachine = tree.manifest.ballotIds.filter((_, i) => i % tree.manifest.machines.length === tree.manifest.machines.indexOf(m));
      const log = tree.logs.get(m.id) as CdfLogFile;
      const events = log.ElectionEventLog.Device[0]?.Event ?? [];
      expect(events.map((e) => e.Id)).toEqual([
        EVENT_IDS.pollsOpened,
        ...onMachine.map(() => EVENT_IDS.voteCast),
        EVENT_IDS.exportComplete,
        EVENT_IDS.pollsClosed,
      ]);
      expect(castBallotIds(log)).toEqual(onMachine);
    }
  });
});

describe("written CVRs (AC3)", () => {
  it("every *.cvr.json has the 1500-103 minimal report shape", async () => {
    const { tree } = await run("ac3", AC);
    expect(tree.cvrs.size).toBe(100);
    for (const [id, file] of tree.cvrs) {
      expect(validateCvrReport(file)).toEqual([]);
      const r = file.CastVoteRecordReport;
      expect(r.Version).toBe("1.0.0");
      expect(r.Election.length).toBeGreaterThan(0);
      expect(r.GPUnit.length).toBeGreaterThan(0);
      expect(r.ReportGeneratingDeviceIds.length).toBe(1);
      expect(r.CVR).toHaveLength(1);
      const cvr = r.CVR[0]!;
      expect(cvr.UniqueId).toBe(id);
      for (const k of ["CreatingDeviceId", "BallotStyleId", "BallotStyleUnitId", "CurrentSnapshotId"] as const) expect(cvr[k]).toBeTruthy();
      const snap = cvr.CVRSnapshot.find((s) => s["@id"] === cvr.CurrentSnapshotId);
      expect(snap?.CVRContest.length).toBe(2);
    }
  });
});

describe("totals and checks", () => {
  it("mismatch-rate 0 gives no faults and every check passes", async () => {
    const { tree } = await run("clean", { ...AC, mismatchRate: 0 });
    expect(tree.manifest.faults).toEqual([]);
    expect(runChecks(tree)).toEqual({ C1: [], C2: [], C3: [], C4: [] });
    expect(tree.county.ballotCount).toBe(100);
    expect(tree.certified.contests).toEqual(tree.county.contests);
  });

  it("each fault fails exactly the check it names", async () => {
    // One fault per run, so a failing check can be attributed to it. Try seeds until every type is seen.
    const seen = new Set<string>();
    for (let seed = 1; seen.size < 4 && seed <= 60; seed++) {
      const { tree } = await run(`single-${seed}`, { ...AC, seed: String(seed), ballots: 20, mismatchRate: 0.05 });
      expect(tree.manifest.faults).toHaveLength(1);
      const f = tree.manifest.faults[0]!;
      seen.add(f.type);
      const failed = runChecks(tree);
      for (const check of ["C1", "C2", "C3", "C4"] as const) {
        expect(failed[check].length > 0, `seed ${seed} ${f.type} ${check}`).toBe(check === f.failsCheck);
      }
      if (f.failsCheck === "C1") expect(failed.C1).toEqual([f.machineId]);
      if (f.failsCheck === "C2") expect(failed.C2).toEqual([f.precinctId]);
    }
    expect(seen.size).toBe(4);
  });

  it("multiple faults of one type never cancel out", async () => {
    const { tree } = await run("many", { ...AC, mismatchRate: 1 });
    const failed = runChecks(tree);
    for (const check of new Set(tree.manifest.faults.map((f) => f.failsCheck))) expect(failed[check].length).toBeGreaterThan(0);
  });
});

describe("determinism (AC5)", () => {
  it("identical flags give byte-identical trees", async () => {
    const a = await run("det-a", AC);
    const b = await run("det-b", AC);
    const ha = await treeHashes(a.dir);
    expect(ha.length).toBe(1 + 4 + 100 + 4);
    expect(await treeHashes(b.dir)).toEqual(ha);
  });

  it("a different seed gives a different tree", async () => {
    const a = await treeHashes((await run("seed-a", AC)).dir);
    const b = await treeHashes((await run("seed-b", { ...AC, seed: "2" })).dir);
    expect(b).not.toEqual(a);
  });

  it("writes canonical JSON and leaves unrelated files alone", async () => {
    const dir = join(root, "canon");
    await writeOutput(dir, simulate({ ...AC, ballots: 3 }));
    await writeFile(join(dir, "notes.txt"), "mine");
    const out = simulate({ ...AC, ballots: 3 });
    await writeOutput(dir, out);
    expect(await listFiles(dir)).toContain("notes.txt");
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(join(dir, "manifest.json"), "utf8");
    expect(text).toBe(canonicalJson(out.manifest));
    expect(text.endsWith("}\n")).toBe(true);
  });
});
