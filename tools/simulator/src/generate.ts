// Deterministic in-memory generation of every output file.

import { alterCertified, alterCounty, alterPrecinct, FAULT_CHECK, faultCountFor, selectFaults } from "./faults.ts";
import { CONTESTS, COUNTY_ID, DEVICE_TYPE, machineIds, precinctIds, timeAt } from "./fixture.ts";
import { buildMachineLog, createClock } from "./formats/cdf-log.ts";
import { buildCvrReport } from "./formats/cvr.ts";
import { buildManifest, MANIFEST_PATH } from "./formats/manifest.ts";
import { cloneTotals, sumTotals, tallyCvrs, totalsPath } from "./formats/totals.ts";
import { createRng, streamSeed } from "./prng.ts";
import type {
  CvrFile,
  ManifestFault,
  ManifestMachine,
  SimulatedBallot,
  SimulateOptions,
  SimulationOutput,
  TotalsFile,
} from "./types.ts";

export const DEFAULTS = { mismatchRate: 0, seed: "0", machines: 4, precincts: 2 } as const;

export function machinePath(machineId: string): string {
  return `machines/${machineId}/vx-logs.cdf.json`;
}

export function cvrPath(ballotId: string): string {
  return `cvrs/${ballotId}.cvr.json`;
}

export function validateOptions(o: SimulateOptions): void {
  if (!Number.isInteger(o.ballots) || o.ballots < 1) throw new RangeError("--ballots must be an integer ≥ 1");
  if (!(o.mismatchRate >= 0 && o.mismatchRate <= 1)) throw new RangeError("--mismatch-rate must be in [0, 1]");
  if (!Number.isInteger(o.machines) || o.machines < 1) throw new RangeError("--machines must be an integer ≥ 1");
  if (!Number.isInteger(o.precincts) || o.precincts < 1) throw new RangeError("--precincts must be an integer ≥ 1");
}

/** Allocate ballots round-robin across machines with PRNG ids and choices. */
export function allocateBallots(options: SimulateOptions, machines: readonly ManifestMachine[]): SimulatedBallot[] {
  const rng = createRng(streamSeed.ballots(options.seed));
  const seen = new Set<string>();
  const perMachine = new Map<string, number>();
  const ballots: SimulatedBallot[] = [];
  for (let i = 0; i < options.ballots; i++) {
    let ballotId = rng.id("ballot");
    while (seen.has(ballotId)) ballotId = rng.id("ballot"); // redraw on a 32-bit collision
    seen.add(ballotId);
    const machine = machines[i % machines.length] as ManifestMachine;
    const selections: Record<string, string> = {};
    for (const c of CONTESTS) selections[c.id] = rng.pick(c.selections).id;
    const seq = perMachine.get(machine.id) ?? 0;
    perMachine.set(machine.id, seq + 1);
    ballots.push({
      index: i,
      ballotId,
      machineId: machine.id,
      precinctId: machine.precinctId,
      sequenceOnMachine: seq,
      selections,
    });
  }
  return ballots;
}

export function simulate(options: SimulateOptions): SimulationOutput {
  validateOptions(options);

  const precincts = precinctIds(options.precincts);
  const machines: ManifestMachine[] = machineIds(options.machines).map((id, i) => ({
    id,
    precinctId: precincts[i % precincts.length] as string,
    type: DEVICE_TYPE,
  }));

  const ballots = allocateBallots(options, machines);

  const faultRng = createRng(streamSeed.faults(options.seed));
  const targets = selectFaults(faultRng, options.ballots, faultCountFor(options.ballots, options.mismatchRate));
  const omitted = new Set(
    targets.filter((t) => t.type === "missing_log_entry").map((t) => (ballots[t.index] as SimulatedBallot).ballotId),
  );

  const files = new Map<string, unknown>();

  // Machine logs. One clock across all machines; every file shares one export time.
  const totalEvents = machines.length * 3 + ballots.length - omitted.size;
  const exportTime = timeAt(totalEvents);
  const clock = createClock();
  for (const m of machines) {
    const onMachine = ballots.filter((b) => b.machineId === m.id);
    files.set(machinePath(m.id), buildMachineLog(m.id, onMachine, omitted, clock, exportTime));
  }

  // CVRs: every ballot, including those with a C1 fault.
  const cvrsByPrecinct = new Map<string, CvrFile[]>(precincts.map((p) => [p, []]));
  for (const b of ballots) {
    const cvr = buildCvrReport(b, exportTime);
    files.set(cvrPath(b.ballotId), cvr);
    cvrsByPrecinct.get(b.precinctId)?.push(cvr);
  }

  // Totals, with faults applied stage by stage so each fault fails only its own check.
  const faults: ManifestFault[] = [];
  const fault = (b: SimulatedBallot, type: ManifestFault["type"], detail: string): void => {
    faults.push({
      ballotId: b.ballotId,
      machineId: b.machineId,
      precinctId: b.precinctId,
      type,
      failsCheck: FAULT_CHECK[type],
      detail,
    });
  };
  const byType = (type: ManifestFault["type"]): SimulatedBallot[] =>
    targets.filter((t) => t.type === type).map((t) => ballots[t.index] as SimulatedBallot);

  for (const b of byType("missing_log_entry")) {
    fault(b, "missing_log_entry", `${machinePath(b.machineId)}: no vote-cast event for ${b.ballotId}; CVR still written`);
  }

  const precinctTotals = new Map<string, TotalsFile>(
    precincts.map((p) => [p, tallyCvrs("precinct", p, cvrsByPrecinct.get(p) ?? [])]),
  );
  for (const b of byType("alter_precinct_totals")) {
    fault(b, "alter_precinct_totals", alterPrecinct(faultRng, b, precinctTotals.get(b.precinctId) as TotalsFile));
  }

  // County election night = sum of the precinct files as published (C2 changes included).
  const county = sumTotals("county-unofficial", COUNTY_ID, [...precinctTotals.values()]);
  for (const b of byType("alter_county_enr_totals")) {
    fault(b, "alter_county_enr_totals", alterCounty(faultRng, county));
  }

  // Certified = election night as published (C3 changes included).
  const certified = cloneTotals(county, "county-certified", COUNTY_ID);
  for (const b of byType("alter_certified_totals")) {
    fault(b, "alter_certified_totals", alterCertified(faultRng, certified));
  }

  for (const [p, t] of precinctTotals) files.set(totalsPath.precinct(p), t);
  files.set(totalsPath.county(COUNTY_ID), county);
  files.set(totalsPath.certified(COUNTY_ID), certified);

  const manifest = buildManifest({
    options,
    precincts,
    machines,
    ballotIds: ballots.map((b) => b.ballotId),
    faults,
    files: [...files.keys()],
  });
  files.set(MANIFEST_PATH, manifest);

  return { manifest, files };
}
