import { describe, expect, it } from "vitest";
import { FAULT_CHECK, FAULT_TYPES, faultCountFor, selectFaults } from "./faults.ts";
import { castBallotIds } from "./formats/cdf-log.ts";
import { machinePath, simulate } from "./generate.ts";
import { createRng, streamSeed } from "./prng.ts";
import type { CdfLogFile } from "./types.ts";

const opts = { ballots: 100, mismatchRate: 0.02, seed: "1", machines: 4, precincts: 2 };

describe("fault selection (AC4)", () => {
  it("round(ballots * rate) faults, each with a type and the check it fails", () => {
    expect(faultCountFor(100, 0.02)).toBe(2);
    expect(faultCountFor(100, 0.025)).toBe(3);
    const { manifest } = simulate(opts);
    expect(manifest.faults).toHaveLength(2);
    expect(manifest.faultCount).toBe(2);
    for (const f of manifest.faults) {
      expect(manifest.ballotIds).toContain(f.ballotId);
      expect(FAULT_TYPES).toContain(f.type);
      expect(["C1", "C2", "C3", "C4"]).toContain(f.failsCheck);
      expect(f.failsCheck).toBe(FAULT_CHECK[f.type]);
      expect(f.detail).not.toBe("");
    }
  });

  it("recomputing fault targets from the seed matches the manifest", () => {
    for (const seed of ["1", "42", "demo"]) {
      const { manifest } = simulate({ ...opts, seed });
      const targets = selectFaults(createRng(streamSeed.faults(seed)), 100, 2);
      const expected = targets
        .map((t) => ({ ballotId: manifest.ballotIds[t.index], type: t.type }))
        .sort((a, b) => (a.ballotId! < b.ballotId! ? -1 : 1));
      expect(manifest.faults.map((f) => ({ ballotId: f.ballotId, type: f.type }))).toEqual(expected);
    }
  });

  it("picks distinct ballots, at most one fault each", () => {
    const targets = selectFaults(createRng("distinct"), 50, 50);
    expect(new Set(targets.map((t) => t.index)).size).toBe(50);
    expect(() => selectFaults(createRng("x"), 2, 3)).toThrow();
  });

  it("C1 omits vote-cast only for the listed ballots", () => {
    const { manifest, files } = simulate({ ...opts, mismatchRate: 0.3 });
    const c1 = new Set(manifest.faults.filter((f) => f.type === "missing_log_entry").map((f) => f.ballotId));
    expect(c1.size).toBeGreaterThan(0);
    const logged = new Set(
      manifest.machines.flatMap((m) => castBallotIds(files.get(machinePath(m.id)) as CdfLogFile)),
    );
    for (const id of manifest.ballotIds) expect(logged.has(id)).toBe(!c1.has(id));
  });
});
