import { describe, expect, it } from "vitest";
import { allocateBallots } from "../generate.ts";
import type { ManifestMachine, SimulatedBallot } from "../types.ts";
import { validateCdfLog } from "../validate/cdf.ts";
import { buildMachineLog, castBallotIds, createClock, EVENT_IDS } from "./cdf-log.ts";

const machines: ManifestMachine[] = [{ id: "mach-01", precinctId: "pct-01", type: "scan-single" }];
const ballots: SimulatedBallot[] = allocateBallots(
  { ballots: 5, mismatchRate: 0, seed: "cdf", machines: 1, precincts: 1 },
  machines,
);

describe("CDF machine log builder", () => {
  it("passes the structural validator", () => {
    const log = buildMachineLog("mach-01", ballots, new Set(), createClock(), "2026-11-03T07:00:00.000Z");
    expect(validateCdfLog(log)).toEqual([]);
    const device = log.ElectionEventLog.Device[0];
    expect(log.ElectionEventLog.Device).toHaveLength(1);
    expect(device?.Version).toBe("vbt-sim-1.0.0");
  });

  it("orders the required events with contiguous sequence numbers", () => {
    const log = buildMachineLog("mach-01", ballots, new Set(), createClock(), "2026-11-03T07:00:00.000Z");
    const events = log.ElectionEventLog.Device[0]?.Event ?? [];
    expect(events.map((e) => e.Id)).toEqual([
      EVENT_IDS.pollsOpened,
      ...ballots.map(() => EVENT_IDS.voteCast),
      EVENT_IDS.exportComplete,
      EVENT_IDS.pollsClosed,
    ]);
    expect(events.map((e) => e.Sequence)).toEqual(events.map((_, i) => i));
    const times = events.map((e) => Date.parse(e.TimeStamp));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(castBallotIds(log)).toEqual(ballots.map((b) => b.ballotId));
  });

  it("omits vote-cast only for omitted ballots", () => {
    const omitted = ballots[2] as SimulatedBallot;
    const log = buildMachineLog("mach-01", ballots, new Set([omitted.ballotId]), createClock(), "2026-11-03T07:00:00.000Z");
    expect(validateCdfLog(log)).toEqual([]);
    expect(castBallotIds(log)).toEqual(ballots.filter((b) => b !== omitted).map((b) => b.ballotId));
  });

  it("validator rejects broken logs", () => {
    expect(validateCdfLog({})).not.toEqual([]);
    const log = buildMachineLog("mach-01", ballots, new Set(), createClock(), "2026-11-03T07:00:00.000Z");
    const ev = log.ElectionEventLog.Device[0]?.Event[1];
    if (ev) ev.Sequence = 9;
    expect(validateCdfLog(log).join()).toMatch(/Sequence/);
  });
});
