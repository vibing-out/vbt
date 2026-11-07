// Fault selection and the totals mutations for C2–C4.

import { CONTESTS } from "./fixture.ts";
import type { Rng } from "./prng.ts";
import { addVotes, totalsPath } from "./formats/totals.ts";
import type { CheckId, FaultType, SimulatedBallot, TotalsFile } from "./types.ts";

export const FAULT_TYPES: readonly FaultType[] = [
  "missing_log_entry",
  "alter_precinct_totals",
  "alter_county_enr_totals",
  "alter_certified_totals",
];

export const FAULT_CHECK: Readonly<Record<FaultType, CheckId>> = {
  missing_log_entry: "C1",
  alter_precinct_totals: "C2",
  alter_county_enr_totals: "C3",
  alter_certified_totals: "C4",
};

export const FAULT_WEIGHTS: ReadonlyArray<{ value: FaultType; weight: number }> = [
  { value: "missing_log_entry", weight: 0.5 },
  { value: "alter_precinct_totals", weight: 0.2 },
  { value: "alter_county_enr_totals", weight: 0.15 },
  { value: "alter_certified_totals", weight: 0.15 },
];

export function faultCountFor(ballots: number, mismatchRate: number): number {
  return Math.round(ballots * mismatchRate);
}

export interface FaultTarget {
  index: number;
  type: FaultType;
}

/**
 * Pick `faultCount` distinct ballot indices and one fault type for each.
 * Uses the faults stream only, so a test can recompute it from the seed.
 * Returned in ballot-index order.
 */
export function selectFaults(rng: Rng, ballots: number, faultCount: number): FaultTarget[] {
  if (faultCount > ballots) throw new RangeError(`faultCount ${faultCount} exceeds ballots ${ballots}`);
  const indices = rng.shuffle(Array.from({ length: ballots }, (_, i) => i)).slice(0, faultCount);
  const targets = indices.map((index) => ({ index, type: rng.weightedPick(FAULT_WEIGHTS) }));
  return targets.sort((a, b) => a.index - b.index);
}

export interface TotalsSet {
  precincts: Map<string, TotalsFile>;
  county: TotalsFile;
  certified: TotalsFile;
}

/** Selection after `selectionId` in the contest, wrapping around. */
function otherSelection(contestId: string, selectionId: string): string {
  const contest = CONTESTS.find((c) => c.id === contestId);
  if (!contest) throw new Error(`unknown contest ${contestId}`);
  const i = contest.selections.findIndex((s) => s.id === selectionId);
  return (contest.selections[(i + 1) % contest.selections.length] as { id: string }).id;
}

/**
 * C2: add one vote for a selection the fault ballot did not choose, in its
 * precinct's totals file. Always +1, so several C2 faults can never cancel out.
 */
export function alterPrecinct(rng: Rng, ballot: SimulatedBallot, precinct: TotalsFile): string {
  const contest = rng.pick(CONTESTS);
  const chosen = ballot.selections[contest.id] as string;
  const decoy = otherSelection(contest.id, chosen);
  addVotes(precinct, contest.id, decoy, 1);
  return `${totalsPath.precinct(precinct.scopeId)}: ${contest.id}/${decoy} +1 (CVR aggregate unchanged; ballot chose ${chosen})`;
}

/** C3: add one vote to the county election-night totals without touching precinct files. */
export function alterCounty(rng: Rng, county: TotalsFile): string {
  const contest = rng.pick(CONTESTS);
  const sel = rng.pick(contest.selections);
  addVotes(county, contest.id, sel.id, 1);
  return `${totalsPath.county(county.scopeId)}: ${contest.id}/${sel.id} +1 (sum of precincts unchanged)`;
}

/** C4: add one vote to the certified totals so they differ from election night. */
export function alterCertified(rng: Rng, certified: TotalsFile): string {
  const contest = rng.pick(CONTESTS);
  const sel = rng.pick(contest.selections);
  addVotes(certified, contest.id, sel.id, 1);
  return `${totalsPath.certified(certified.scopeId)}: ${contest.id}/${sel.id} +1 (election-night totals unchanged)`;
}
