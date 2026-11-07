// Acceptance (T-10): NIST files -> importers -> C1 to C4. A clean election passes all four checks; each
// injected fault fails exactly the expected check for exactly the faulted scope, the other three pass,
// and only the ballots there are affected and challenged.
import {
  affectedBallotIds,
  type CheckScope,
  type CrossCheckId,
  type CrossCheckRun,
  type RecordedBallot,
  runCrossChecks,
} from "@vbt/domain";
import { describe, expect, test } from "vitest";
import { importCdfLogJson } from "./cdf-log-json.ts";
import { importCdfLogXml } from "./cdf-log-xml.ts";
import { type ImportResult } from "./parse.ts";
import { importElectionReportText, toCheckRecords } from "./results-1500-100.ts";
import { buildFixture, type Fault, FAULT_TARGET, FAULTS, type Fixture } from "./testing/election-fixture.ts";

function unwrap<T>(result: ImportResult<T>): T {
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.value;
}

function run(fixture: Fixture): CrossCheckRun {
  const machineLogs = fixture.eventLogs.flatMap((f) => unwrap((f.format === "json" ? importCdfLogJson : importCdfLogXml)(f.text)).machines);
  const rows = [...fixture.precinctReports, ...fixture.electionNight, ...fixture.certified].flatMap((t) => unwrap(importElectionReportText(t)));
  return runCrossChecks({
    ballots: fixture.ballots,
    machineLogs,
    precinctTallies: fixture.precinctTallies,
    resolutions: fixture.resolutions,
    ...toCheckRecords(rows),
  });
}

describe("a clean election (acceptance: clean runs pass all four checks)", () => {
  const fixture = buildFixture();
  const result = run(fixture);

  test("reads JSON and XML machine logs and every 1500-100 stage", () => {
    expect(new Set(fixture.eventLogs.map((f) => f.format))).toEqual(new Set(["json", "xml"]));
  });

  test("passes C1 to C4 at every machine, precinct and county with no mismatches", () => {
    expect(result.passed).toBe(true);
    const counts = Object.fromEntries((["C1", "C2", "C3", "C4"] as const).map((c) => [c, result.results.filter((r) => r.check === c && r.passed).length]));
    // C3: two counties plus the two precincts of the county that breaks its report down.
    expect(counts).toEqual({ C1: 4, C2: 3, C3: 4, C4: 2 });
    expect(result.results.every((r) => r.mismatches.length === 0)).toBe(true);
    expect(result.challenges).toEqual([]);
  });

  test("has spoiled ballots and no resolutions", () => {
    expect(fixture.ballots.some((b) => b.status === "SPOILED")).toBe(true);
    expect(fixture.resolutions).toEqual([]);
  });
});

type Expected = { fails: { check: CrossCheckId; scope: CheckScope; scopeId: string } | null; inScope: (b: RecordedBallot) => boolean };

const EXPECTED: Record<Fault, Expected> = {
  "machine-log-undercount": {
    fails: { check: "C1", scope: "machine", scopeId: FAULT_TARGET.machine },
    inScope: (b) => b.machineId === FAULT_TARGET.machine,
  },
  "precinct-report-altered": {
    fails: { check: "C2", scope: "precinct", scopeId: FAULT_TARGET.precinct },
    inScope: (b) => b.precinctId === FAULT_TARGET.precinct,
  },
  "enr-precinct-figure": {
    fails: { check: "C3", scope: "precinct", scopeId: FAULT_TARGET.breakdownPrecinct },
    inScope: (b) => b.precinctId === FAULT_TARGET.breakdownPrecinct,
  },
  "enr-county-total": {
    fails: { check: "C3", scope: "county", scopeId: FAULT_TARGET.county },
    inScope: (b) => b.countyId === FAULT_TARGET.county,
  },
  "certified-unexplained": {
    fails: { check: "C4", scope: "county", scopeId: FAULT_TARGET.certifiedCounty },
    inScope: (b) => b.countyId === FAULT_TARGET.certifiedCounty,
  },
  // Positive control: certified = election night minus a recorded discard's totals.
  "certified-recorded-discard": { fails: null, inScope: () => false },
};

describe.each(FAULTS)("fault table: %s (acceptance: fails exactly the expected check)", (fault) => {
  const expected = EXPECTED[fault];
  const fixture = buildFixture(fault);
  const result = run(fixture);
  const failed = result.results.filter((r) => !r.passed);
  const ids = (list: readonly RecordedBallot[]) => list.map((b) => b.id).sort();

  test(expected.fails ? `fails ${expected.fails.check} for that ${expected.fails.scope} only; the other checks pass` : "passes all four checks", () => {
    expect(failed.map((r) => ({ check: r.check, scope: r.scope, scopeId: r.scopeId }))).toEqual(expected.fails ? [expected.fails] : []);
    expect(result.passed).toBe(expected.fails === null);
    const passing = new Set(result.results.filter((r) => r.passed).map((r) => r.check));
    for (const check of ["C1", "C2", "C3", "C4"] as const) {
      if (check !== expected.fails?.check) expect(passing.has(check)).toBe(true);
    }
  });

  test("affects exactly the ballots of the failing scope", () => {
    const affected = failed.flatMap((r) => affectedBallotIds(r, fixture.ballots));
    expect(affected).toEqual(ids(fixture.ballots.filter(expected.inScope)));
  });

  test("challenges only the affected ballots that can be challenged", () => {
    const challengeable = fixture.ballots.filter((b) => expected.inScope(b) && b.status === "CAST");
    expect(result.challenges.map((c) => c.ballotId)).toEqual(ids(challengeable));
    expect(result.challenges.every((c) => c.to === "CHALLENGED" && c.event_type === "MISMATCH_DETECTED")).toBe(true);
    if (expected.fails) expect(challengeable.length).toBeGreaterThan(0);
  });
});

test("the fault table covers each check, and C3 both with and without a precinct breakdown", () => {
  const fails = FAULTS.map((f) => EXPECTED[f].fails).filter((f) => f !== null);
  expect([...new Set(fails.map((f) => f.check))].sort()).toEqual(["C1", "C2", "C3", "C4"]);
  expect(fails.filter((f) => f.check === "C3").map((f) => f.scope).sort()).toEqual(["county", "precinct"]);
});
