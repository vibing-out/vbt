import { expect, test } from "vitest";
import { buildPlan, COUNTY_ID, createRng, DEFAULT_SEED, FULL_RUN, mismatchCount, validateOptions } from "./plan.ts";

const full = () => buildPlan({ ...FULL_RUN, seed: DEFAULT_SEED });

test("AC1: the full run is 10,000 ballots, 500 per precinct, exactly 50 mismatched, 20 machines", () => {
  const plan = full();
  expect(plan.ballots).toHaveLength(10_000);
  expect(plan.precincts).toHaveLength(20);
  expect(new Set(plan.precincts.map((p) => p.machineId)).size).toBe(20);
  for (const p of plan.precincts) expect(plan.ballots.filter((b) => b.precinctId === p.id)).toHaveLength(500);
  expect(plan.ballots.filter((b) => b.mismatch)).toHaveLength(50);
  expect(plan.mismatchCount).toBe(50);
});

test("AC1: one machine per precinct, so one tracking-code chain per machine", () => {
  const plan = full();
  for (const p of plan.precincts) {
    const machines = new Set(plan.ballots.filter((b) => b.precinctId === p.id).map((b) => b.machineId));
    expect([...machines]).toEqual([p.machineId]);
  }
});

test("the demo county and its ids are its own, and fit requireRole's 64-character target limit", () => {
  const plan = full();
  expect(plan.countyId).toBe(COUNTY_ID);
  expect(plan.precincts[0]).toEqual({ id: "SCALE-DEMO-001", countyId: "SCALE-DEMO", name: "Scale Demo Precinct 01", machineId: "M-SCALE-DEMO-001-A" });
  expect(plan.precincts[19]?.id).toBe("SCALE-DEMO-020");
  for (const p of plan.precincts) expect(p.id.length).toBeLessThanOrEqual(64);
});

test("the same seed gives the same plan; another seed picks other ballots", () => {
  expect(full()).toEqual(full());
  const flagged = (seed: string) => buildPlan({ ...FULL_RUN, seed }).ballots.flatMap((b, i) => (b.mismatch ? [i] : []));
  expect(flagged("a")).not.toEqual(flagged("b"));
});

test("mismatch count is Math.round(ballots × rate)", () => {
  expect(mismatchCount(10_000, 0.005)).toBe(50);
  expect(mismatchCount(200, 0.05)).toBe(10);
  expect(mismatchCount(10, 0)).toBe(0);
  expect(buildPlan({ ballots: 200, precincts: 4, rate: 0.05, seed: "x" }).ballots.filter((b) => b.mismatch)).toHaveLength(10);
  expect(buildPlan({ ballots: 7, precincts: 2, rate: 1, seed: "x" }).ballots.every((b) => b.mismatch)).toBe(true);
});

test("precinct sizes differ by at most one", () => {
  const plan = buildPlan({ ballots: 10, precincts: 3, rate: 0, seed: "x" });
  expect(plan.precincts.map((p) => plan.ballots.filter((b) => b.precinctId === p.id).length)).toEqual([4, 3, 3]);
});

test("every ballot selects one listed choice per contest", () => {
  for (const b of buildPlan({ ballots: 50, precincts: 2, rate: 0, seed: "x" }).ballots) {
    expect(b.plaintext.contests.map((c) => c.contestId)).toEqual(["governor", "measure-1"]);
    for (const c of b.plaintext.contests) expect(c.choiceIds).toHaveLength(1);
  }
});

test("the PRNG is deterministic and in range", () => {
  const a = createRng("s");
  const b = createRng("s");
  for (let i = 0; i < 100; i++) {
    const n = a.int(7);
    expect(n).toBe(b.int(7));
    expect(n >= 0 && n < 7).toBe(true);
  }
});

test.each([
  [{ ballots: 0 }, /ballots/],
  [{ ballots: 1.5 }, /ballots/],
  [{ precincts: 0 }, /precincts/],
  [{ precincts: 1000 }, /precincts/],
  [{ ballots: 3, precincts: 4 }, /exceed/],
  [{ rate: -0.1 }, /rate/],
  [{ rate: 1.1 }, /rate/],
  [{ rate: Number.NaN }, /rate/],
  [{ seed: "" }, /seed/],
])("refuses options %j", (override, message) => {
  expect(() => validateOptions({ ballots: 10, precincts: 2, rate: 0.1, seed: "x", ...override })).toThrow(message);
});
