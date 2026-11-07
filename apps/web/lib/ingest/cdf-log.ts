import { IngestError } from "./errors";

// Machine event logs, in the shape epic/4's simulator writes (tools/simulator/src/formats/cdf-log.ts): a
// VotingWorks-shaped CDF election event log, ElectionEventLog > Device[] > Event[]. A ballot counted by a
// machine is an event with Id "vote-cast" and Disposition "success" (castBallotIds in the simulator).
// Only the per-device count leaves this parser: event times and details stay in the file.

export const VOTE_CAST = "vote-cast";
const MAX_ID = 64;

export interface MachineLog {
  /** Device id -> ballots counted in its log. */
  readonly counts: ReadonlyMap<string, number>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseCdfLog(json: unknown): MachineLog {
  if (!isObject(json) || !isObject(json.ElectionEventLog)) throw new IngestError("not a CDF election event log");
  const devices = json.ElectionEventLog.Device;
  if (!Array.isArray(devices) || devices.length === 0) throw new IngestError("the event log lists no devices");
  const counts = new Map<string, number>();
  for (const device of devices) {
    if (!isObject(device)) throw new IngestError("a device entry is not an object");
    const id = device.Id;
    if (typeof id !== "string" || id.trim() === "" || id.length > MAX_ID) throw new IngestError("a device has no valid Id");
    if (counts.has(id)) throw new IngestError(`device ${id} appears twice`);
    if (!Array.isArray(device.Event)) throw new IngestError(`device ${id} has no Event list`);
    let cast = 0;
    for (const event of device.Event) {
      if (!isObject(event) || typeof event.Id !== "string" || typeof event.Disposition !== "string") {
        throw new IngestError(`device ${id} has an event without Id or Disposition`);
      }
      if (event.Id === VOTE_CAST && event.Disposition === "success") cast++;
    }
    counts.set(id, cast);
  }
  return { counts };
}
