// Run manifest: inputs, topology, ballot ids and every injected fault.

import { COUNTY_ID, ELECTION_ID } from "../fixture.ts";
import type { Manifest, ManifestFault, ManifestMachine, SimulateOptions } from "../types.ts";

export const MANIFEST_PATH = "manifest.json";

export function buildManifest(input: {
  options: SimulateOptions;
  precincts: string[];
  machines: ManifestMachine[];
  ballotIds: string[];
  faults: ManifestFault[];
  files: string[];
}): Manifest {
  const { options } = input;
  return {
    version: 1,
    seed: options.seed,
    ballots: options.ballots,
    mismatchRate: options.mismatchRate,
    faultCount: input.faults.length,
    electionId: ELECTION_ID,
    countyId: COUNTY_ID,
    precincts: input.precincts,
    machines: input.machines,
    // Cast order, which is also the round-robin machine assignment order.
    ballotIds: input.ballotIds,
    faults: input.faults.slice().sort((a, b) => compare(a.ballotId, b.ballotId)),
    // Every other file in the run, sorted; manifest.json does not list itself.
    files: input.files.filter((f) => f !== MANIFEST_PATH).sort(compare),
  };
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
