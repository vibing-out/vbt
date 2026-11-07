// The scale demo's plan: precincts, machines, ballot selections and which ballots are mismatched.
// Pure and seeded: no crypto, no I/O, no clock, no Math.random. Same options, same plan.

import type { BallotPlaintext, ElectionManifest } from "./crypto-adapter.ts";

export const COUNTY_ID = "SCALE-DEMO";
export const BALLOT_STYLE = "general-2026";
/** Election day, as on the receipt mockup (docs/voter-journey.md). */
export const CAST_DATE = "2026-11-03";
export const VENDOR = "SimVendor";
export const MODEL = "SV-1";

/** The demo's own contests (2 contests × 3 choices). Content only; no real candidates. */
export const MANIFEST: ElectionManifest = Object.freeze({
  contests: Object.freeze([
    Object.freeze({ id: "governor", choices: Object.freeze([{ id: "gov-a" }, { id: "gov-b" }, { id: "gov-c" }]) }),
    Object.freeze({ id: "measure-1", choices: Object.freeze([{ id: "m1-yes" }, { id: "m1-no" }, { id: "m1-abstain" }]) }),
  ]),
});

export interface PlanOptions {
  ballots: number;
  precincts: number;
  /** Share of ballots found mismatched, 0..1. */
  rate: number;
  seed: string;
}

export const FULL_RUN: Readonly<Omit<PlanOptions, "seed">> = Object.freeze({ ballots: 10_000, precincts: 20, rate: 0.005 });
export const DEFAULT_SEED = "vbt-scale-demo";
const MAX_PRECINCTS = 999;

export interface PlannedPrecinct {
  id: string;
  countyId: string;
  name: string;
  machineId: string;
}

export interface PlannedBallot {
  precinctId: string;
  machineId: string;
  plaintext: BallotPlaintext;
  mismatch: boolean;
}

export interface Plan {
  options: PlanOptions;
  countyId: string;
  precincts: PlannedPrecinct[];
  /** Grouped by precinct; within a machine, in casting order (the tracking-code chain order). */
  ballots: PlannedBallot[];
  mismatchCount: number;
}

/** Exactly Math.round(ballots × rate), as epic/4's simulator (faults.ts faultCountFor). */
export function mismatchCount(ballots: number, rate: number): number {
  return Math.round(ballots * rate);
}

/** FNV-1a seed hash feeding Mulberry32: deterministic, never Math.random. */
export function createRng(seed: string): { next(): number; int(n: number): number } {
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 0x01000193);
  }
  state >>>= 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n) };
}

export function validateOptions(options: PlanOptions): void {
  const { ballots, precincts, rate, seed } = options;
  if (!Number.isSafeInteger(ballots) || ballots < 1) throw new RangeError("ballots must be a positive integer");
  if (!Number.isSafeInteger(precincts) || precincts < 1 || precincts > MAX_PRECINCTS) {
    throw new RangeError(`precincts must be an integer from 1 to ${MAX_PRECINCTS}`);
  }
  if (precincts > ballots) throw new RangeError("precincts must not exceed ballots");
  if (!(rate >= 0 && rate <= 1)) throw new RangeError("rate must be from 0 to 1");
  if (typeof seed !== "string" || seed === "") throw new RangeError("seed must be a non-empty string");
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

export function buildPlan(options: PlanOptions): Plan {
  validateOptions(options);
  const precincts: PlannedPrecinct[] = Array.from({ length: options.precincts }, (_, i) => {
    const id = `${COUNTY_ID}-${pad(i + 1, 3)}`;
    return { id, countyId: COUNTY_ID, name: `Scale Demo Precinct ${pad(i + 1, 2)}`, machineId: `M-${id}-A` };
  });

  // Seeded streams per concern, so the selections and the mismatch choice can each be recomputed.
  const selections = createRng(`${options.seed}:ballots`);
  const faults = createRng(`${options.seed}:mismatches`);

  const count = mismatchCount(options.ballots, options.rate);
  // Distinct indices: a seeded partial Fisher–Yates shuffle, first `count` positions.
  const indices = Array.from({ length: options.ballots }, (_, i) => i);
  for (let i = 0; i < count; i++) {
    const j = i + faults.int(options.ballots - i);
    [indices[i], indices[j]] = [indices[j] as number, indices[i] as number];
  }
  const flagged = new Set(indices.slice(0, count));

  // Precinct sizes differ by at most one: the first (ballots mod precincts) get one extra.
  const base = Math.floor(options.ballots / options.precincts);
  const extra = options.ballots % options.precincts;
  const ballots: PlannedBallot[] = [];
  precincts.forEach((precinct, p) => {
    const size = base + (p < extra ? 1 : 0);
    for (let k = 0; k < size; k++) {
      const plaintext: BallotPlaintext = {
        contests: MANIFEST.contests.map((contest) => ({
          contestId: contest.id,
          choiceIds: [(contest.choices[selections.int(contest.choices.length)] as { id: string }).id],
        })),
      };
      ballots.push({ precinctId: precinct.id, machineId: precinct.machineId, plaintext, mismatch: flagged.has(ballots.length) });
    }
  });

  return { options: { ...options }, countyId: COUNTY_ID, precincts, ballots, mismatchCount: count };
}
