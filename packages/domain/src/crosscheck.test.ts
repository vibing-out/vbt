import { describe, expect, test } from "vitest";
import {
  checkCertification,
  checkMachineCounts,
  CROSS_CHECKS,
  mismatchReason,
  planBatch,
  subtractTotals,
  sumTotals,
  type Totals,
  totalsEqual,
} from "./crosscheck.ts";

const t = (ballotCount: number, contests: Record<string, Record<string, number>>): Totals => ({ ballotCount, contests });

describe("C1 checkMachineCounts", () => {
  test("passes when every machine's log count equals its ballots", () => {
    expect(checkMachineCounts({ A: 17, B: 3 }, { A: 17, B: 3 })).toEqual([]);
  });

  test("returns only the machines that disagree, sorted", () => {
    expect(checkMachineCounts({ B: 2, A: 16, C: 1 }, { A: 17, B: 2, C: 1 })).toEqual(["A"]);
  });

  test("a machine missing from one side counts as zero there", () => {
    expect(checkMachineCounts({ A: 0 }, {})).toEqual([]);
    expect(checkMachineCounts({}, { A: 4 })).toEqual(["A"]);
    expect(checkMachineCounts({ Z: 1 }, { A: 0 })).toEqual(["Z"]);
  });

  test("inherited keys are not machines", () => {
    expect(checkMachineCounts({ toString: 0 }, {})).toEqual([]);
    expect(checkMachineCounts(JSON.parse('{"__proto__": 2}') as Record<string, number>, {})).toEqual(["__proto__"]);
  });
});

describe("totals arithmetic", () => {
  const a = t(3, { president: { a: 2, b: 1 }, q1: { yes: 3 } });
  const b = t(2, { president: { a: 1, b: 1 }, q1: { yes: 1, no: 1 } });

  test("sumTotals adds counts and votes, treating missing selections as zero", () => {
    const sum = sumTotals([a, b]);
    expect(sum.ballotCount).toBe(5);
    expect({ ...sum.contests.president }).toEqual({ a: 3, b: 2 });
    expect({ ...sum.contests.q1 }).toEqual({ yes: 4, no: 1 });
    expect(sumTotals([]).ballotCount).toBe(0);
  });

  test("subtractTotals may go negative", () => {
    const diff = subtractTotals(b, a);
    expect(diff.ballotCount).toBe(-1);
    expect({ ...diff.contests.q1 }).toEqual({ yes: -2, no: 1 });
  });

  test("totalsEqual: same counts are equal; zero and missing are the same", () => {
    expect(totalsEqual(a, t(3, { q1: { yes: 3, no: 0 }, president: { b: 1, a: 2 } }))).toBe(true);
    expect(totalsEqual(a, t(4, a.contests as Record<string, Record<string, number>>))).toBe(false);
    expect(totalsEqual(a, t(3, { president: { a: 1, b: 2 }, q1: { yes: 3 } }))).toBe(false);
  });

  test("a __proto__ contest is data, not a prototype", () => {
    const evil = JSON.parse('{"ballotCount": 1, "contests": {"__proto__": {"x": 1}}}') as Totals;
    const sum = sumTotals([evil]);
    expect(Object.hasOwn(sum.contests, "__proto__")).toBe(true);
    expect(totalsEqual(evil, t(1, {}))).toBe(false);
  });
});

describe("C4 checkCertification", () => {
  const electionNight = t(10, { p: { a: 6, b: 4 } });

  test("passes when certified equals the ballots now reported and nothing was removed", () => {
    expect(checkCertification({ electionNight, certified: electionNight, current: electionNight, removed: t(0, {}) })).toBe(true);
  });

  test("passes when the difference is explained by a recorded challenge or discard", () => {
    const certified = t(9, { p: { a: 5, b: 4 } });
    expect(checkCertification({ electionNight, certified, current: certified, removed: t(1, { p: { a: 1 } }) })).toBe(true);
  });

  test("fails on an unexplained difference", () => {
    const certified = t(9, { p: { a: 5, b: 4 } });
    expect(checkCertification({ electionNight, certified, current: certified, removed: t(0, {}) })).toBe(false);
  });

  test("fails when the certified file disagrees with the ballots being certified", () => {
    const certified = t(10, { p: { a: 7, b: 3 } });
    expect(checkCertification({ electionNight, certified, current: electionNight, removed: t(0, {}) })).toBe(false);
  });
});

describe("planBatch", () => {
  const ballots = [
    { id: "1", machineId: "A" },
    { id: "2", machineId: "B" },
    { id: "3", machineId: "A" },
  ];

  test("everything advances when every check passes", () => {
    expect(planBatch({ ballots, failedMachines: [], scopeFailed: null })).toEqual({ advance: ["1", "2", "3"], challenge: [] });
  });

  test("a C1 failure challenges only that machine's ballots", () => {
    expect(planBatch({ ballots, failedMachines: ["A"], scopeFailed: null })).toEqual({
      advance: ["2"],
      challenge: [
        { id: "1", check: "C1" },
        { id: "3", check: "C1" },
      ],
    });
  });

  test("a scope-wide failure challenges every ballot; C1 wins for its machine", () => {
    expect(planBatch({ ballots, failedMachines: ["B"], scopeFailed: "C2" })).toEqual({
      advance: [],
      challenge: [
        { id: "1", check: "C2" },
        { id: "2", check: "C1" },
        { id: "3", check: "C2" },
      ],
    });
  });
});

test("mismatch reasons name the check only", () => {
  for (const check of CROSS_CHECKS) expect(mismatchReason(check)).toMatch(/^Cross-check C[1-4] failed$/);
});
