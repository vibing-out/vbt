// The four cross-checks (T-10). Three independent records must agree at every stage before ballots
// advance; any disagreement fails the check for that machine, precinct or county, and the ballots there
// move to CHALLENGED.
// Source: docs/locked-interfaces.md § Cross-checks. Mapping to the NIST formats: docs/nist-mapping.md.
//
// No I/O and no crypto: callers pass records already parsed (the @vbt/events importers) and the
// ElectionGuard tally already decrypted in aggregate. Nothing here reads a time, and every output holds
// ids and counts only.

import { type BallotStatus, isBallotStatus } from "./status.ts";
import { transition } from "./transition.ts";

/** Aggregate vote totals: contest id -> selection id -> votes. Never per-ballot data. */
export type Totals = Readonly<Record<string, Readonly<Record<string, number>>>>;

export const CROSS_CHECK_IDS = Object.freeze(["C1", "C2", "C3", "C4"] as const);
export type CrossCheckId = (typeof CROSS_CHECK_IDS)[number];

export const CHECK_SCOPES = Object.freeze(["machine", "precinct", "county"] as const);
export type CheckScope = (typeof CHECK_SCOPES)[number];

export type CrossCheckDefinition = {
  readonly id: CrossCheckId;
  readonly name: string;
  /** The status the check gates: ballots move into it only after the check passes. */
  readonly runsAt: BallotStatus;
  /** The scopes a result can name. C3 names a precinct when the county report breaks down by precinct. */
  readonly scopes: readonly CheckScope[];
};

/** The locked check table, in order. */
const definition = (d: CrossCheckDefinition): CrossCheckDefinition => Object.freeze({ ...d, scopes: Object.freeze([...d.scopes]) });

export const CROSS_CHECKS: readonly CrossCheckDefinition[] = Object.freeze([
  definition({ id: "C1", name: "Machine count", runsAt: "TALLIED_PRECINCT", scopes: ["machine"] }),
  definition({ id: "C2", name: "Precinct totals", runsAt: "TALLIED_PRECINCT", scopes: ["precinct"] }),
  definition({ id: "C3", name: "Election-night totals", runsAt: "REPORTED_UNOFFICIAL", scopes: ["county", "precinct"] }),
  definition({ id: "C4", name: "Certification", runsAt: "CERTIFIED", scopes: ["county"] }),
]);

const RUNS_AT = Object.fromEntries(CROSS_CHECKS.map((c) => [c.id, c.runsAt])) as Record<CrossCheckId, BallotStatus>;

/** One ballot in the ElectionGuard record (officials only). A SPOILED ballot was not cast. */
export type RecordedBallot = {
  readonly id: string;
  readonly machineId: string;
  readonly precinctId: string;
  readonly countyId: string;
  readonly status: BallotStatus;
};

/** NIST SP 1500-101: ballots counted in one machine's event log. */
export type MachineLogCount = { readonly machineId: string; readonly ballotsCounted: number };

/** ElectionGuard: the precinct's tally, decrypted in aggregate. */
export type PrecinctTally = { readonly precinctId: string; readonly totals: Totals };

/**
 * NIST SP 1500-100, precinct level: a precinct's totals inside a county. Either the report a precinct
 * sent to the county (C2, C3) or the precinct breakdown of the county's election-night report (C3).
 */
export type PrecinctReport = { readonly precinctId: string; readonly countyId: string; readonly totals: Totals };

/** NIST SP 1500-100, county level: election-night or certified totals, and ballots cast when reported. */
export type CountyResult = { readonly countyId: string; readonly totals: Totals; readonly ballotCount?: number };

/**
 * A recorded decision between election night and certification, with the aggregate totals of the
 * ballots it names (decrypted in aggregate, never per ballot).
 *   removed     ballots challenged or discarded since election night: still CHALLENGED or DISCARDED
 *   reinstated  challenged ballots resolved back: in a challengeable status again
 */
export type RecordedResolution = {
  readonly countyId: string;
  readonly kind: "removed" | "reinstated";
  readonly ballotIds: readonly string[];
  readonly totals: Totals;
};

/** Why a check failed. Mirrored by the check_results_failure_check constraint. */
export const CHECK_FAILURES = Object.freeze([
  /** One record has the machine, precinct or county and the other does not. */
  "MISSING_SOURCE",
  /** One record holds the same machine, precinct or county twice, so neither copy can be trusted. */
  "DUPLICATE_SOURCE",
  /** C1: the machine has ballots but its log counted none (no successful vote-cast events). */
  "NO_BALLOT_COUNT_EVENTS",
  "COUNT_MISMATCH",
  "TOTALS_MISMATCH",
  /** C4: a resolution names no ballot, names one twice, or names one not in that county and status. */
  "INVALID_RESOLUTION",
  /** C4: certified differs from election night by more than the recorded resolutions explain. */
  "UNEXPLAINED_DIFFERENCE",
] as const);
export type CheckFailure = (typeof CHECK_FAILURES)[number];

/** One differing figure. Ids and counts only. */
export type Mismatch =
  | { readonly field: "ballot_count"; readonly expected: number; readonly actual: number }
  | {
      readonly field: "votes";
      readonly contestId: string;
      readonly selectionId: string;
      readonly expected: number;
      readonly actual: number;
    };

export type CheckResult = {
  readonly check: CrossCheckId;
  readonly scope: CheckScope;
  readonly scopeId: string;
  /** The status the check gates (CROSS_CHECKS runsAt). */
  readonly stage: BallotStatus;
  readonly passed: boolean;
  readonly failure: CheckFailure | null;
  readonly mismatches: readonly Mismatch[];
};

// ---------------------------------------------------------------------------------------------------
// Totals helpers
// ---------------------------------------------------------------------------------------------------

const sortedKeys = (...records: ReadonlyArray<Readonly<Record<string, unknown>>>): string[] =>
  [...new Set(records.flatMap((r) => Object.keys(r)))].sort();

/** Every (contest, selection) where the two totals differ, over the union of keys; missing counts as 0. */
export function diffTotals(expected: Totals, actual: Totals): Mismatch[] {
  const out: Mismatch[] = [];
  for (const contestId of sortedKeys(expected, actual)) {
    const e = expected[contestId] ?? {};
    const a = actual[contestId] ?? {};
    for (const selectionId of sortedKeys(e, a)) {
      const ev = e[selectionId] ?? 0;
      const av = a[selectionId] ?? 0;
      if (ev !== av) out.push({ field: "votes", contestId, selectionId, expected: ev, actual: av });
    }
  }
  return out;
}

/** The sum of several totals, each multiplied by `sign` (1 by default). */
export function sumTotals(all: readonly Totals[], sign: 1 | -1 = 1): Totals {
  const out: Record<string, Record<string, number>> = {};
  for (const totals of all) {
    for (const [contestId, selections] of Object.entries(totals)) {
      const contest = (out[contestId] ??= {});
      for (const [selectionId, votes] of Object.entries(selections)) {
        contest[selectionId] = (contest[selectionId] ?? 0) + sign * votes;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------------------------------

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

type Outcome = { failure: CheckFailure | null; mismatches?: Mismatch[] };

function result(check: CrossCheckId, scope: CheckScope, scopeId: string, outcome: Outcome): CheckResult {
  return {
    check,
    scope,
    scopeId,
    stage: RUNS_AT[check],
    passed: outcome.failure === null,
    failure: outcome.failure,
    mismatches: outcome.mismatches ?? [],
  };
}

/** Pairs two records by key: a key on one side only is MISSING_SOURCE, twice on a side DUPLICATE_SOURCE. */
function pair<L, R>(
  left: Map<string, L[]>,
  right: Map<string, R[]>,
  compare: (l: L, r: R, key: string) => Outcome,
): Array<[string, Outcome]> {
  return sortedKeys(Object.fromEntries(left), Object.fromEntries(right)).map((key) => {
    const l = left.get(key) ?? [];
    const r = right.get(key) ?? [];
    if (l.length === 0 || r.length === 0) return [key, { failure: "MISSING_SOURCE" }];
    if (l.length > 1 || r.length > 1) return [key, { failure: "DUPLICATE_SOURCE" }];
    return [key, compare(l[0]!, r[0]!, key)];
  });
}

const compareTotals = (expected: Totals, actual: Totals): Outcome => {
  const mismatches = diffTotals(expected, actual);
  return { failure: mismatches.length ? "TOTALS_MISMATCH" : null, mismatches };
};

// ---------------------------------------------------------------------------------------------------
// C1 to C4
// ---------------------------------------------------------------------------------------------------

/** C1 Machine count: ballots counted in each machine's event log = ElectionGuard ballots cast on it. */
export function checkMachineCounts(logs: readonly MachineLogCount[], ballots: readonly RecordedBallot[]): CheckResult[] {
  const cast = groupBy(
    ballots.filter((b) => b.status !== "SPOILED"),
    (b) => b.machineId,
  );
  const logsByMachine = groupBy(logs, (l) => l.machineId);
  // A machine whose log counts no ballot and that cast none has no ElectionGuard entry: still a pass.
  const castOrLogged = new Map([...logsByMachine.keys()].map((id) => [id, [cast.get(id) ?? []]]));
  for (const [id, list] of cast) castOrLogged.set(id, [list]);
  return pair(logsByMachine, castOrLogged, (log, castHere): Outcome => {
    const expected = log.ballotsCounted;
    const actual = castHere.length;
    const mismatches: Mismatch[] = expected === actual ? [] : [{ field: "ballot_count", expected, actual }];
    if (expected === 0 && actual > 0) return { failure: "NO_BALLOT_COUNT_EVENTS", mismatches };
    return { failure: mismatches.length ? "COUNT_MISMATCH" : null, mismatches };
  }).map(([machineId, outcome]) => result("C1", "machine", machineId, outcome));
}

/** C2 Precinct totals: the ElectionGuard tally for each precinct = the totals it reported to the county. */
export function checkPrecinctTotals(tallies: readonly PrecinctTally[], reports: readonly PrecinctReport[]): CheckResult[] {
  return pair(
    groupBy(tallies, (t) => t.precinctId),
    groupBy(reports, (r) => r.precinctId),
    (t, r) => compareTotals(t.totals, r.totals),
  ).map(([precinctId, outcome]) => result("C2", "precinct", precinctId, outcome));
}

/**
 * C3 Election-night totals: the sum of each county's precinct reports = its published election-night
 * totals. When the county's election-night report also breaks down by precinct (`breakdown`), each
 * precinct is compared too, so a mismatch names the precinct rather than the whole county.
 */
export function checkElectionNightTotals(
  reports: readonly PrecinctReport[],
  electionNight: readonly CountyResult[],
  breakdown: readonly PrecinctReport[] = [],
): CheckResult[] {
  const summed = [...groupBy(reports, (r) => r.countyId)].map(([countyId, list]) => ({
    countyId,
    totals: sumTotals(list.map((r) => r.totals)),
  }));
  const counties = pair(
    groupBy(summed, (s) => s.countyId),
    groupBy(electionNight, (c) => c.countyId),
    (s, c) => compareTotals(s.totals, c.totals),
  ).map(([countyId, outcome]) => result("C3", "county", countyId, outcome));

  const brokenDown = new Set(breakdown.map((b) => b.countyId));
  const precincts = pair(
    groupBy(
      reports.filter((r) => brokenDown.has(r.countyId)),
      (r) => r.precinctId,
    ),
    groupBy(breakdown, (b) => b.precinctId),
    (r, b) => compareTotals(r.totals, b.totals),
  ).map(([precinctId, outcome]) => result("C3", "precinct", precinctId, outcome));

  return [...counties, ...precincts];
}

const REMOVED: ReadonlySet<BallotStatus> = new Set<BallotStatus>(["CHALLENGED", "DISCARDED"]);
const REINSTATED: ReadonlySet<BallotStatus> = new Set<BallotStatus>(["CAST", "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL"]);

/**
 * C4 Certification: certified = election night − removed totals + reinstated totals, and the ballot
 * counts reconcile the same way when both reports carry one. Each resolution must name only ballots of
 * its county in the matching status, and no ballot twice; any other difference is unexplained.
 */
export function checkCertification(
  electionNight: readonly CountyResult[],
  certified: readonly CountyResult[],
  resolutions: readonly RecordedResolution[],
  ballots: readonly RecordedBallot[],
): CheckResult[] {
  const byId = new Map(ballots.map((b) => [b.id, b]));
  const resolutionsByCounty = groupBy(resolutions, (r) => r.countyId);
  return pair(
    groupBy(electionNight, (c) => c.countyId),
    groupBy(certified, (c) => c.countyId),
    (night, cert, countyId): Outcome => {
      const recorded = resolutionsByCounty.get(countyId) ?? [];
      const named = recorded.flatMap((r) => r.ballotIds);
      const valid =
        recorded.every((r) => r.ballotIds.length > 0) &&
        new Set(named).size === named.length &&
        recorded.every((r) =>
          r.ballotIds.every((id) => {
            const ballot = byId.get(id);
            const allowed = r.kind === "removed" ? REMOVED : REINSTATED;
            return ballot !== undefined && ballot.countyId === countyId && allowed.has(ballot.status);
          }),
        );
      if (!valid) return { failure: "INVALID_RESOLUTION" };

      const removed = recorded.filter((r) => r.kind === "removed");
      const reinstated = recorded.filter((r) => r.kind === "reinstated");
      const expected = sumTotals([
        night.totals,
        sumTotals(removed.map((r) => r.totals), -1),
        ...reinstated.map((r) => r.totals),
      ]);
      const mismatches = diffTotals(expected, cert.totals);
      if (night.ballotCount !== undefined && cert.ballotCount !== undefined) {
        const count = (list: readonly RecordedResolution[]) => list.reduce((n, r) => n + r.ballotIds.length, 0);
        const expectedCount = night.ballotCount - count(removed) + count(reinstated);
        if (expectedCount !== cert.ballotCount) {
          mismatches.unshift({ field: "ballot_count", expected: expectedCount, actual: cert.ballotCount });
        }
      }
      return { failure: mismatches.length ? "UNEXPLAINED_DIFFERENCE" : null, mismatches };
    },
  ).map(([countyId, outcome]) => result("C4", "county", countyId, outcome));
}

// ---------------------------------------------------------------------------------------------------
// Affected ballots and the challenges a mismatch creates
// ---------------------------------------------------------------------------------------------------

const IN_SCOPE: Readonly<Record<CheckScope, (b: RecordedBallot) => string>> = {
  machine: (b) => b.machineId,
  precinct: (b) => b.precinctId,
  county: (b) => b.countyId,
};

/** Every ballot in a failed check's machine, precinct or county, sorted (never in cast order). */
export function affectedBallotIds(result: CheckResult, ballots: readonly RecordedBallot[]): string[] {
  if (result.passed) return [];
  const key = IN_SCOPE[result.scope];
  return ballots
    .filter((b) => key(b) === result.scopeId)
    .map((b) => b.id)
    .sort();
}

/** A ballot a mismatch moves to CHALLENGED, written as a MISMATCH_DETECTED ballot event. */
export type MismatchChallenge = {
  readonly ballotId: string;
  readonly from: BallotStatus;
  readonly to: "CHALLENGED";
  readonly event_type: "MISMATCH_DETECTED";
};

/**
 * The CHALLENGED transitions the failed checks create: one per affected ballot whose status allows the
 * move (transition()). Certified, discarded, spoiled and already-challenged ballots are left alone.
 */
export function planMismatchChallenges(
  results: readonly CheckResult[],
  ballots: readonly RecordedBallot[],
): MismatchChallenge[] {
  const affected = new Set(results.flatMap((r) => affectedBallotIds(r, ballots)));
  return ballots
    .filter((b) => affected.has(b.id) && transition({ from: b.status, to: "CHALLENGED" }).ok)
    .map((b): MismatchChallenge => ({ ballotId: b.id, from: b.status, to: "CHALLENGED", event_type: "MISMATCH_DETECTED" }))
    .sort((a, b) => a.ballotId.localeCompare(b.ballotId));
}

// ---------------------------------------------------------------------------------------------------
// All four
// ---------------------------------------------------------------------------------------------------

export type CrossCheckInput = {
  readonly ballots: readonly RecordedBallot[];
  readonly machineLogs: readonly MachineLogCount[];
  readonly precinctTallies: readonly PrecinctTally[];
  readonly precinctReports: readonly PrecinctReport[];
  readonly electionNight: readonly CountyResult[];
  /** Precinct breakdown of the county election-night reports, where they carry one. */
  readonly electionNightPrecincts?: readonly PrecinctReport[];
  readonly certified: readonly CountyResult[];
  readonly resolutions: readonly RecordedResolution[];
};

export type CrossCheckRun = {
  readonly results: readonly CheckResult[];
  readonly passed: boolean;
  readonly challenges: readonly MismatchChallenge[];
};

/** Runs C1 to C4 over a full set of records, in check order. */
export function runCrossChecks(input: CrossCheckInput): CrossCheckRun {
  for (const ballot of input.ballots) {
    if (!isBallotStatus(ballot.status)) throw new TypeError(`ballot ${ballot.id} has an invalid status`);
  }
  const results = [
    ...checkMachineCounts(input.machineLogs, input.ballots),
    ...checkPrecinctTotals(input.precinctTallies, input.precinctReports),
    ...checkElectionNightTotals(input.precinctReports, input.electionNight, input.electionNightPrecincts),
    ...checkCertification(input.electionNight, input.certified, input.resolutions, input.ballots),
  ];
  return {
    results,
    passed: results.every((r) => r.passed),
    challenges: planMismatchChallenges(results, input.ballots),
  };
}
