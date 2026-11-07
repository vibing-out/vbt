// Cross-checks that gate batch transitions (T-09).
// Source: docs/locked-interfaces.md § Cross-checks (C1–C4) and the mismatch rule under § Ballot status
// state machine: any disagreement moves the affected ballots to CHALLENGED.
// No I/O: apps/web parses the uploaded files, reads the ballots and decrypts aggregates, then asks these
// functions whether the records agree and which ballots advance.
//
// Totals are keyed by contest and selection ids that come from uploaded files, so every map here is
// built with Object.create(null) and read with Object.hasOwn: a "__proto__" key is data, never a prototype.

import type { CrossCheckId, Totals } from "./cross-checks.ts";

/** Aggregate totals with how many ballots they cover. Never per ballot. */
export interface BatchTotals {
  readonly ballotCount: number;
  readonly contests: Totals;
}

export interface CrossCheckResult {
  readonly check: CrossCheckId;
  readonly ok: boolean;
}

/** The public reason written on a MISMATCH_DETECTED event: the check only, never a machine, count or time. */
export function mismatchReason(check: CrossCheckId): string {
  return `Cross-check ${check} failed`;
}

const own = (record: object, key: string): boolean => Object.hasOwn(record, key);

function countOf(record: Readonly<Record<string, number>>, key: string): number {
  return own(record, key) ? (record[key] as number) : 0;
}

/**
 * C1 machine count: for every machine named in either map, the ballots counted in its event log must
 * equal the ballots recorded as cast on it. Returns the machines that disagree, sorted; empty when C1
 * passes. A machine missing from one side counts as zero there.
 */
export function findMachineMismatches(
  logCounts: Readonly<Record<string, number>>,
  ballotCounts: Readonly<Record<string, number>>,
): string[] {
  const machines = new Set([...Object.keys(logCounts), ...Object.keys(ballotCounts)]);
  return [...machines].filter((m) => countOf(logCounts, m) !== countOf(ballotCounts, m)).sort();
}

function emptyRow(): Record<string, number> {
  return Object.create(null) as Record<string, number>;
}

function emptyContests(): Record<string, Record<string, number>> {
  return Object.create(null) as Record<string, Record<string, number>>;
}

/** Adds `sign` × each part into one BatchTotals. Missing contests and selections count as zero. */
function combine(parts: ReadonlyArray<{ totals: BatchTotals; sign: 1 | -1 }>): BatchTotals {
  let ballotCount = 0;
  const contests = emptyContests();
  for (const { totals, sign } of parts) {
    ballotCount += sign * totals.ballotCount;
    for (const contestId of Object.keys(totals.contests)) {
      const source = totals.contests[contestId] as Readonly<Record<string, number>>;
      const row = own(contests, contestId) ? (contests[contestId] as Record<string, number>) : emptyRow();
      contests[contestId] = row;
      for (const selectionId of Object.keys(source)) {
        row[selectionId] = countOf(row, selectionId) + sign * (source[selectionId] as number);
      }
    }
  }
  return { ballotCount, contests };
}

/** The sum of several totals (C3: precinct totals add up to the county's). */
export function sumBatchTotals(parts: readonly BatchTotals[]): BatchTotals {
  return combine(parts.map((totals) => ({ totals, sign: 1 })));
}

/** a − b, contest by contest. Results may be negative. */
export function subtractTotals(a: BatchTotals, b: BatchTotals): BatchTotals {
  return combine([
    { totals: a, sign: 1 },
    { totals: b, sign: -1 },
  ]);
}

/**
 * True when both report the same ballot count and the same votes for every contest and selection
 * either names. A selection listed with 0 votes on one side and missing on the other is equal.
 */
export function totalsEqual(a: BatchTotals, b: BatchTotals): boolean {
  const diff = subtractTotals(a, b);
  if (diff.ballotCount !== 0) return false;
  return Object.values(diff.contests).every((row) => Object.values(row).every((n) => n === 0));
}

export interface CertificationInput {
  /** The county's published election-night (REPORTED_UNOFFICIAL) totals. */
  readonly electionNight: BatchTotals;
  /** The certified totals file. */
  readonly certified: BatchTotals;
  /** Decrypted totals of the county's ballots now at REPORTED_UNOFFICIAL (the ones to certify). */
  readonly current: BatchTotals;
  /** Decrypted totals of the ballots that left REPORTED_UNOFFICIAL through a challenge or discard. */
  readonly removed: BatchTotals;
}

/**
 * C4 certification: certified totals equal the ballots being certified, and every difference from the
 * election-night totals is explained by a recorded challenge or discard (election night − certified =
 * removed).
 */
export function certificationExplained(input: CertificationInput): boolean {
  return (
    totalsEqual(input.certified, input.current) &&
    totalsEqual(subtractTotals(input.electionNight, input.certified), input.removed)
  );
}

export interface PlannedBallot {
  readonly id: string;
  readonly machineId: string;
}

export interface BatchPlanInput {
  /** Every ballot in the batch's scope at its `from` status. */
  readonly ballots: readonly PlannedBallot[];
  /** Machines that failed C1: only their ballots are challenged. */
  readonly failedMachines: readonly string[];
  /** A scope-wide check that failed (C2, C3 or C4): every ballot in the batch is challenged. */
  readonly scopeFailed: CrossCheckId | null;
}

export interface BatchPlan {
  readonly advance: string[];
  readonly challenge: Array<{ id: string; check: CrossCheckId }>;
}

/**
 * Which ballots advance and which are challenged. A ballot on a machine that failed C1 is challenged
 * for C1; otherwise a failed scope-wide check challenges it for that check; otherwise it advances.
 * Every input ballot lands in exactly one list.
 */
export function planBatch(input: BatchPlanInput): BatchPlan {
  const failed = new Set(input.failedMachines);
  const advance: string[] = [];
  const challenge: Array<{ id: string; check: CrossCheckId }> = [];
  for (const ballot of input.ballots) {
    if (failed.has(ballot.machineId)) challenge.push({ id: ballot.id, check: "C1" });
    else if (input.scopeFailed !== null) challenge.push({ id: ballot.id, check: input.scopeFailed });
    else advance.push(ballot.id);
  }
  return { advance, challenge };
}
