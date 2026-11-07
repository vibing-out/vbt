import { describe, expect, test } from "vitest";
import {
  affectedBallotIds,
  type CheckResult,
  checkCertification,
  checkElectionNightTotals,
  checkMachineCounts,
  checkPrecinctTotals,
  type CountyResult,
  CROSS_CHECK_IDS,
  CROSS_CHECKS,
  type CrossCheckInput,
  diffTotals,
  type PrecinctReport,
  planMismatchChallenges,
  type RecordedBallot,
  type RecordedResolution,
  runCrossChecks,
  sumTotals,
} from "./cross-checks.ts";
import { BALLOT_STATUSES, type BallotStatus } from "./status.ts";

// Two counties: K1 holds P1 (machines M1, M2) and P2 (M3); K2 holds P3 (M4).
const ballot = (id: string, machineId: string, precinctId: string, countyId: string, status: BallotStatus = "CAST") =>
  ({ id, machineId, precinctId, countyId, status }) satisfies RecordedBallot;

const BALLOTS: RecordedBallot[] = [
  ballot("b-01", "M1", "P1", "K1"),
  ballot("b-02", "M1", "P1", "K1"),
  ballot("b-03", "M1", "P1", "K1", "SPOILED"),
  ballot("b-04", "M2", "P1", "K1"),
  ballot("b-05", "M3", "P2", "K1"),
  ballot("b-06", "M3", "P2", "K1", "DISCARDED"),
  ballot("b-07", "M4", "P3", "K2"),
];

const P1 = { mayor: { ada: 2, bo: 1 } };
const P2 = { mayor: { ada: 1, bo: 1 } };
const P3 = { mayor: { ada: 0, bo: 1 } };
const K1 = { mayor: { ada: 3, bo: 2 } };
const K2 = { mayor: { ada: 0, bo: 1 } };

// b-06 (one vote for bo in P2) was discarded after election night.
const DISCARD: RecordedResolution = { countyId: "K1", kind: "removed", ballotIds: ["b-06"], totals: { mayor: { bo: 1 } } };

const clean = (): CrossCheckInput => ({
  ballots: BALLOTS,
  machineLogs: [
    { machineId: "M1", ballotsCounted: 2 },
    { machineId: "M2", ballotsCounted: 1 },
    { machineId: "M3", ballotsCounted: 2 },
    { machineId: "M4", ballotsCounted: 1 },
  ],
  precinctTallies: [
    { precinctId: "P1", totals: P1 },
    { precinctId: "P2", totals: P2 },
    { precinctId: "P3", totals: P3 },
  ],
  precinctReports: [
    { precinctId: "P1", countyId: "K1", totals: P1 },
    { precinctId: "P2", countyId: "K1", totals: P2 },
    { precinctId: "P3", countyId: "K2", totals: P3 },
  ],
  electionNight: [
    { countyId: "K1", totals: K1, ballotCount: 5 },
    { countyId: "K2", totals: K2 },
  ],
  // K1 breaks its election-night report down by precinct; K2 does not.
  electionNightPrecincts: [
    { precinctId: "P1", countyId: "K1", totals: P1 },
    { precinctId: "P2", countyId: "K1", totals: P2 },
  ],
  certified: [
    { countyId: "K1", totals: { mayor: { ada: 3, bo: 1 } }, ballotCount: 4 },
    { countyId: "K2", totals: K2 },
  ],
  resolutions: [DISCARD],
});

const failed = (results: readonly CheckResult[]) => results.filter((r) => !r.passed);
const ids = (results: readonly CheckResult[]) => results.map((r) => `${r.check}:${r.scope}:${r.scopeId}`);

describe("the locked check table", () => {
  test("lists C1 to C4 with the stage each one gates and the scopes it can name", () => {
    expect(CROSS_CHECKS.map((c) => c.id)).toEqual([...CROSS_CHECK_IDS]);
    expect(CROSS_CHECKS.map((c) => [c.id, c.runsAt, c.scopes])).toEqual([
      ["C1", "TALLIED_PRECINCT", ["machine"]],
      ["C2", "TALLIED_PRECINCT", ["precinct"]],
      ["C3", "REPORTED_UNOFFICIAL", ["county", "precinct"]],
      ["C4", "CERTIFIED", ["county"]],
    ]);
  });
});

describe("totals helpers", () => {
  test("diffTotals compares the union of keys, treats a missing one as 0 and lists every cell sorted", () => {
    expect(diffTotals({ b: { x: 1 }, a: { y: 2 } }, { a: { y: 2, z: 0 }, c: { w: 3 } })).toEqual([
      { field: "votes", contestId: "b", selectionId: "x", expected: 1, actual: 0 },
      { field: "votes", contestId: "c", selectionId: "w", expected: 0, actual: 3 },
    ]);
  });

  test("sumTotals adds, or subtracts with sign -1", () => {
    expect(sumTotals([P1, P2, { council: { cy: 4 } }])).toEqual({ mayor: { ada: 3, bo: 2 }, council: { cy: 4 } });
    expect(sumTotals([P1, P2], -1)).toEqual({ mayor: { ada: -3, bo: -2 } });
    expect(sumTotals([])).toEqual({});
  });
});

describe("clean runs (acceptance: all four checks pass)", () => {
  test("pass every machine, precinct and county with no mismatches and challenge nothing", () => {
    const run = runCrossChecks(clean());
    expect(run.passed).toBe(true);
    expect(run.challenges).toEqual([]);
    expect(ids(run.results)).toEqual([
      "C1:machine:M1",
      "C1:machine:M2",
      "C1:machine:M3",
      "C1:machine:M4",
      "C2:precinct:P1",
      "C2:precinct:P2",
      "C2:precinct:P3",
      "C3:county:K1",
      "C3:county:K2",
      "C3:precinct:P1",
      "C3:precinct:P2",
      "C4:county:K1",
      "C4:county:K2",
    ]);
    expect(new Set(run.results.map((r) => r.check))).toEqual(new Set(CROSS_CHECK_IDS));
    expect(run.results.every((r) => r.mismatches.length === 0 && r.failure === null)).toBe(true);
    expect(run.results.map((r) => [r.check, r.stage])).toContainEqual(["C4", "CERTIFIED"]);
  });

  test("work without a precinct breakdown at all", () => {
    const { electionNightPrecincts: _, ...input } = clean();
    const run = runCrossChecks(input);
    expect(run.passed).toBe(true);
    expect(run.results.filter((r) => r.check === "C3").map((r) => r.scope)).toEqual(["county", "county"]);
  });

  test("refuse a ballot whose status is outside the domain", () => {
    const input = { ...clean(), ballots: [{ ...BALLOTS[0]!, status: "LOST" as BallotStatus }] };
    expect(() => runCrossChecks(input)).toThrow(TypeError);
  });
});

describe("C1 machine count", () => {
  test("excludes spoiled ballots and counts discarded ones (they were cast)", () => {
    expect(failed(checkMachineCounts(clean().machineLogs, BALLOTS))).toEqual([]);
  });

  test("a log count that differs fails that machine with the two counts", () => {
    const logs = clean().machineLogs.map((l) => (l.machineId === "M1" ? { ...l, ballotsCounted: 3 } : l));
    expect(failed(checkMachineCounts(logs, BALLOTS))).toEqual([
      {
        check: "C1",
        scope: "machine",
        scopeId: "M1",
        stage: "TALLIED_PRECINCT",
        passed: false,
        failure: "COUNT_MISMATCH",
        mismatches: [{ field: "ballot_count", expected: 3, actual: 2 }],
      },
    ]);
  });

  test("a log with no counted ballots for a machine that has ballots fails with NO_BALLOT_COUNT_EVENTS", () => {
    const logs = clean().machineLogs.map((l) => (l.machineId === "M4" ? { ...l, ballotsCounted: 0 } : l));
    expect(failed(checkMachineCounts(logs, BALLOTS))).toMatchObject([
      { scopeId: "M4", failure: "NO_BALLOT_COUNT_EVENTS", mismatches: [{ field: "ballot_count", expected: 0, actual: 1 }] },
    ]);
  });

  test("a machine with ballots but no log fails as a missing source", () => {
    const logs = clean().machineLogs.filter((l) => l.machineId !== "M2");
    expect(failed(checkMachineCounts(logs, BALLOTS))).toMatchObject([{ scopeId: "M2", failure: "MISSING_SOURCE", mismatches: [] }]);
  });

  test("a log for a machine with no cast ballots passes at zero and fails above it", () => {
    const zero = [...clean().machineLogs, { machineId: "M9", ballotsCounted: 0 }];
    expect(failed(checkMachineCounts(zero, BALLOTS))).toEqual([]);
    const four = [...clean().machineLogs, { machineId: "M9", ballotsCounted: 4 }];
    expect(failed(checkMachineCounts(four, BALLOTS))).toMatchObject([{ scopeId: "M9", failure: "COUNT_MISMATCH" }]);
  });

  test("two logs for one machine fail as a duplicate source", () => {
    const logs = [...clean().machineLogs, { machineId: "M4", ballotsCounted: 1 }];
    expect(failed(checkMachineCounts(logs, BALLOTS))).toMatchObject([{ scopeId: "M4", failure: "DUPLICATE_SOURCE" }]);
  });
});

describe("C2 precinct totals", () => {
  test("a reported total that differs from the ElectionGuard tally fails that precinct with every differing cell", () => {
    const { precinctTallies, precinctReports } = clean();
    const reports = precinctReports.map((r) => (r.precinctId === "P1" ? { ...r, totals: { mayor: { ada: 1, bo: 2 } } } : r));
    expect(failed(checkPrecinctTotals(precinctTallies, reports))).toEqual([
      {
        check: "C2",
        scope: "precinct",
        scopeId: "P1",
        stage: "TALLIED_PRECINCT",
        passed: false,
        failure: "TOTALS_MISMATCH",
        mismatches: [
          { field: "votes", contestId: "mayor", selectionId: "ada", expected: 2, actual: 1 },
          { field: "votes", contestId: "mayor", selectionId: "bo", expected: 1, actual: 2 },
        ],
      },
    ]);
  });

  test("a precinct missing from either record fails as a missing source", () => {
    const { precinctTallies, precinctReports } = clean();
    const results = checkPrecinctTotals(
      precinctTallies.filter((t) => t.precinctId !== "P3"),
      precinctReports.filter((r) => r.precinctId !== "P2"),
    );
    expect(failed(results).map((r) => [r.scopeId, r.failure])).toEqual([
      ["P2", "MISSING_SOURCE"],
      ["P3", "MISSING_SOURCE"],
    ]);
  });

  test("two reports for one precinct fail as a duplicate source", () => {
    const { precinctTallies, precinctReports } = clean();
    const results = checkPrecinctTotals(precinctTallies, [...precinctReports, precinctReports[2]!]);
    expect(failed(results).map((r) => [r.scopeId, r.failure])).toEqual([["P3", "DUPLICATE_SOURCE"]]);
  });
});

describe("C3 election-night totals", () => {
  test("without a breakdown, a county total that differs from its precincts' sum fails the county", () => {
    const { precinctReports } = clean();
    const night: CountyResult[] = [
      { countyId: "K1", totals: K1 },
      { countyId: "K2", totals: { mayor: { ada: 1, bo: 1 } } },
    ];
    expect(failed(checkElectionNightTotals(precinctReports, night))).toEqual([
      {
        check: "C3",
        scope: "county",
        scopeId: "K2",
        stage: "REPORTED_UNOFFICIAL",
        passed: false,
        failure: "TOTALS_MISMATCH",
        mismatches: [{ field: "votes", contestId: "mayor", selectionId: "ada", expected: 0, actual: 1 }],
      },
    ]);
  });

  test("with a breakdown, a changed precinct figure fails that precinct and not the county", () => {
    const { precinctReports, electionNight, electionNightPrecincts } = clean();
    const breakdown = electionNightPrecincts!.map((b) => (b.precinctId === "P2" ? { ...b, totals: { mayor: { ada: 2, bo: 1 } } } : b));
    expect(ids(failed(checkElectionNightTotals(precinctReports, electionNight, breakdown)))).toEqual(["C3:precinct:P2"]);
  });

  test("a breakdown that leaves out a precinct fails that precinct as a missing source", () => {
    const { precinctReports, electionNight, electionNightPrecincts } = clean();
    const results = checkElectionNightTotals(precinctReports, electionNight, electionNightPrecincts!.slice(0, 1));
    expect(failed(results).map((r) => [r.scope, r.scopeId, r.failure])).toEqual([["precinct", "P2", "MISSING_SOURCE"]]);
  });

  test("a county with precinct reports but no published totals fails as a missing source", () => {
    const { precinctReports, electionNight } = clean();
    const results = checkElectionNightTotals(precinctReports, electionNight.slice(0, 1));
    expect(failed(results).map((r) => [r.scopeId, r.failure])).toEqual([["K2", "MISSING_SOURCE"]]);
  });

  test("two published totals for one county fail as a duplicate source", () => {
    const { precinctReports, electionNight } = clean();
    const results = checkElectionNightTotals(precinctReports, [...electionNight, electionNight[1]!]);
    expect(failed(results).map((r) => [r.scopeId, r.failure])).toEqual([["K2", "DUPLICATE_SOURCE"]]);
  });

  test("without a breakdown, only the county sum is compared", () => {
    const reports: PrecinctReport[] = [{ precinctId: "PX", countyId: "K2", totals: K2 }];
    expect(failed(checkElectionNightTotals(reports, [{ countyId: "K2", totals: K2 }]))).toEqual([]);
  });
});

describe("C4 certification", () => {
  const ballots = BALLOTS.map((b) => (b.id === "b-01" ? { ...b, status: "REPORTED_UNOFFICIAL" as const } : b));

  test("certified = election night minus a recorded discard's totals passes (positive control)", () => {
    const { electionNight, certified } = clean();
    expect(failed(checkCertification(electionNight, certified, [DISCARD], ballots))).toEqual([]);
  });

  test("an unexplained difference fails the county with the votes and ballot count it cannot explain", () => {
    const { electionNight, certified } = clean();
    expect(failed(checkCertification(electionNight, certified, [], ballots))).toEqual([
      {
        check: "C4",
        scope: "county",
        scopeId: "K1",
        stage: "CERTIFIED",
        passed: false,
        failure: "UNEXPLAINED_DIFFERENCE",
        mismatches: [
          { field: "ballot_count", expected: 5, actual: 4 },
          { field: "votes", contestId: "mayor", selectionId: "bo", expected: 2, actual: 1 },
        ],
      },
    ]);
  });

  test("a ballot count off by one with equal totals still fails", () => {
    const { electionNight, certified } = clean();
    const cert = certified.map((c) => (c.countyId === "K1" ? { ...c, ballotCount: 3 } : c));
    expect(failed(checkCertification(electionNight, cert, [DISCARD], ballots))).toMatchObject([
      { scopeId: "K1", failure: "UNEXPLAINED_DIFFERENCE", mismatches: [{ field: "ballot_count", expected: 4, actual: 3 }] },
    ]);
  });

  test("a challenged ballot resolved back adds its totals and count again", () => {
    const night: CountyResult[] = [{ countyId: "K2", totals: { mayor: { ada: 0, bo: 0 } }, ballotCount: 0 }];
    const cert: CountyResult[] = [{ countyId: "K2", totals: K2, ballotCount: 1 }];
    const back: RecordedResolution = { countyId: "K2", kind: "reinstated", ballotIds: ["b-07"], totals: { mayor: { bo: 1 } } };
    expect(failed(checkCertification(night, cert, [back], ballots))).toEqual([]);
    expect(failed(checkCertification(night, cert, [], ballots))).toMatchObject([{ scopeId: "K2", failure: "UNEXPLAINED_DIFFERENCE" }]);
  });

  test.each([
    ["names a ballot that is not challenged or discarded", "removed", ["b-05"]],
    ["reinstates a ballot that is still discarded", "reinstated", ["b-06"]],
    ["names a ballot in another county", "removed", ["b-07"]],
    ["names an unknown ballot", "removed", ["b-99"]],
    ["names no ballot", "removed", []],
    ["names the same ballot twice", "removed", ["b-06", "b-06"]],
  ] as const)("a resolution that %s fails as invalid", (_, kind, ballotIds) => {
    const { electionNight, certified } = clean();
    const resolution: RecordedResolution = { countyId: "K1", kind, ballotIds, totals: { mayor: { bo: 1 } } };
    const results = checkCertification(electionNight, certified, [resolution], ballots);
    expect(failed(results).map((r) => [r.scopeId, r.failure, r.mismatches])).toEqual([["K1", "INVALID_RESOLUTION", []]]);
  });

  test("a challenged (not yet resolved) ballot may explain a difference", () => {
    const { electionNight, certified } = clean();
    const held = ballots.map((b) => (b.id === "b-06" ? { ...b, status: "CHALLENGED" as const } : b));
    expect(failed(checkCertification(electionNight, certified, [DISCARD], held))).toEqual([]);
  });

  test("a county missing certified totals fails as a missing source", () => {
    const { electionNight, certified } = clean();
    const results = checkCertification(electionNight, certified.slice(0, 1), [DISCARD], ballots);
    expect(failed(results).map((r) => [r.scopeId, r.failure])).toEqual([["K2", "MISSING_SOURCE"]]);
  });

  test("two certified totals for one county fail as a duplicate source", () => {
    const { electionNight, certified } = clean();
    const results = checkCertification(electionNight, [...certified, certified[1]!], [DISCARD], ballots);
    expect(failed(results).map((r) => [r.scopeId, r.failure])).toEqual([["K2", "DUPLICATE_SOURCE"]]);
  });
});

describe("affected ballots", () => {
  const failure = (scope: CheckResult["scope"], scopeId: string): CheckResult => ({
    check: "C3",
    scope,
    scopeId,
    stage: "REPORTED_UNOFFICIAL",
    passed: false,
    failure: "TOTALS_MISMATCH",
    mismatches: [],
  });

  test.each([
    ["machine", "M1", ["b-01", "b-02", "b-03"]],
    ["precinct", "P2", ["b-05", "b-06"]],
    ["county", "K2", ["b-07"]],
  ] as const)("a failed %s check names every ballot there, sorted", (scope, scopeId, expected) => {
    expect(affectedBallotIds(failure(scope, scopeId), [...BALLOTS].reverse())).toEqual(expected);
  });

  test("a passed check names none", () => {
    expect(affectedBallotIds({ ...failure("county", "K1"), passed: true, failure: null }, BALLOTS)).toEqual([]);
  });
});

describe("planMismatchChallenges (acceptance: challenges only where transition() allows)", () => {
  const precinctFailure: CheckResult = {
    check: "C2",
    scope: "precinct",
    scopeId: "P",
    stage: "TALLIED_PRECINCT",
    passed: false,
    failure: "TOTALS_MISMATCH",
    mismatches: [],
  };
  const everyStatus = BALLOT_STATUSES.map((status, i) => ballot(`s-${i}-${status}`, "M", "P", "K", status));

  test("returns a MISMATCH_DETECTED -> CHALLENGED move for CAST, TALLIED_PRECINCT and REPORTED_UNOFFICIAL only", () => {
    expect(planMismatchChallenges([precinctFailure], everyStatus)).toEqual(
      (["CAST", "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL"] as const).map((from) => ({
        ballotId: `s-${BALLOT_STATUSES.indexOf(from)}-${from}`,
        from,
        to: "CHALLENGED",
        event_type: "MISMATCH_DETECTED",
      })),
    );
  });

  test.each(["CERTIFIED", "DISCARDED", "SPOILED", "CHALLENGED"] as const)("returns nothing for a %s ballot", (status) => {
    expect(planMismatchChallenges([precinctFailure], [ballot("x", "M", "P", "K", status)])).toEqual([]);
  });

  test("one challenge per ballot even when several checks fail over it, sorted by ballot", () => {
    const input = clean();
    const run = runCrossChecks({
      ...input,
      machineLogs: input.machineLogs.map((l) => (l.machineId === "M2" ? { ...l, ballotsCounted: 5 } : l)),
      precinctTallies: input.precinctTallies.map((t) => (t.precinctId === "P1" ? { ...t, totals: {} } : t)),
    });
    expect(ids(failed(run.results))).toEqual(["C1:machine:M2", "C2:precinct:P1"]);
    // b-03 is spoiled: affected but never challenged.
    expect(run.challenges.map((c) => c.ballotId)).toEqual(["b-01", "b-02", "b-04"]);
  });
});
