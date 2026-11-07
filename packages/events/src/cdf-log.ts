// NIST SP 1500-101 Election Event Logging CDF (V1): the model both log importers share, its validation
// and the per-device summary check C1 reads. The JSON importer validates the parsed file directly; the
// XML importer converts its tree to the same JSON shape first, so both apply identical rules.
// Schema: https://raw.githubusercontent.com/usnistgov/ElectionEventLogging/master/NIST_V1_election_event_logging.json
// Mapping: docs/nist-mapping.md § Machine event logs.
//
// Privacy: Event.TimeStamp and Event.Sequence are required by the schema and checked, but never leave
// this module. The summary keeps counts and flags only, and machine_log_imports stores only that.

import { lookupNistCode, type NistCodeUse } from "./nist-codes.ts";
import { type EventType } from "./event-types.ts";
import { type ImportResult, type Json, Problems } from "./parse.ts";

export const LOG_FORMATS = Object.freeze(["cdf-json", "cdf-xml"] as const);
export type LogFormat = (typeof LOG_FORMATS)[number];

export const DISPOSITIONS = Object.freeze(["failure", "na", "other", "success"] as const);
export type Disposition = (typeof DISPOSITIONS)[number];

/** One log event, normalized: no time and no sequence number. */
export type MachineLogEvent = {
  /** Device.Id, which must equal machines.id (the C1 join key). */
  readonly machineId: string;
  /** The vendor Event.Id, unchanged. */
  readonly nist_event_code: string;
  /** The ballot event type it corresponds to (only vote-cast has one), or null. */
  readonly event_type: EventType | null;
  /** What VBT uses it for, or null when the code is unmapped. */
  readonly use: NistCodeUse | null;
  readonly disposition: Disposition;
};

/** One machine's log, as machine_log_imports stores it. */
export type MachineLogSummary = {
  readonly machineId: string;
  /** Successful vote-cast events. */
  readonly ballotsCounted: number;
  readonly pollsOpened: boolean;
  readonly pollsClosed: boolean;
  /** Events with a mapped error code or a failure Disposition, each counted once. */
  readonly errorCount: number;
  /** Event.Ids VBT does not map, sorted and unique. */
  readonly unmappedCodes: readonly string[];
};

export type MachineLogImport = {
  readonly format: LogFormat;
  /** ElectionEventLog.ElectionId, when the log has one. */
  readonly electionId: string | null;
  /** One per Device, sorted by machine id. */
  readonly machines: readonly MachineLogSummary[];
  /** Every event in file order, normalized. */
  readonly events: readonly MachineLogEvent[];
};

const DISPOSITION_SET: ReadonlySet<string> = new Set(DISPOSITIONS);
const REQUIRED_STRINGS = ["Id", "Sequence", "TimeStamp", "Type"] as const;

/** Validates a parsed ElectionEventLog (JSON shape) and summarizes it per device. */
export function readEventLog(input: unknown, format: LogFormat): ImportResult<MachineLogImport> {
  const p = new Problems();
  const events: MachineLogEvent[] = [];
  const machines: MachineLogSummary[] = [];
  let electionId: string | null = null;
  const log = p.object(input, "$", "EventLogging.ElectionEventLog");
  if (log) {
    if (log.ElectionId !== undefined) electionId = p.id(log.ElectionId, "$.ElectionId") ?? null;
    p.id(log.GeneratedTime, "$.GeneratedTime");
    const seen = new Set<string>();
    (p.array(log.Device, "$.Device", true) ?? []).forEach((rawDevice, d) => {
      const path = `$.Device[${d}]`;
      const device = p.object(rawDevice, path, "EventLogging.Device");
      if (!device) return;
      const machineId = p.id(device.Id, `${path}.Id`);
      if (machineId !== undefined && seen.has(machineId)) p.add(`${path}.Id`, "a device Id not already in this log");
      if (machineId !== undefined) seen.add(machineId);

      const summary = { ballotsCounted: 0, pollsOpened: false, pollsClosed: false, errorCount: 0 };
      const unmapped = new Set<string>();
      (p.array(device.Event, `${path}.Event`, true) ?? []).forEach((rawEvent, e) => {
        const ePath = `${path}.Event[${e}]`;
        const event: Json | undefined = p.object(rawEvent, ePath, "EventLogging.Event");
        if (!event) return;
        const fields = REQUIRED_STRINGS.map((f) => p.id(event[f], `${ePath}.${f}`));
        const disposition = event.Disposition;
        if (typeof disposition !== "string" || !DISPOSITION_SET.has(disposition)) {
          p.add(`${ePath}.Disposition`, `one of ${DISPOSITIONS.join(", ")}`);
          return;
        }
        const id = fields[0];
        if (id === undefined || machineId === undefined || fields.includes(undefined)) return;

        const mapped = lookupNistCode(id);
        if (!mapped) unmapped.add(id);
        const ok = disposition === "success";
        if (mapped?.use === "ballot-count" && ok) summary.ballotsCounted += 1;
        if (mapped?.use === "polls-opened" && ok) summary.pollsOpened = true;
        if (mapped?.use === "polls-closed" && ok) summary.pollsClosed = true;
        if (mapped?.use === "error" || disposition === "failure") summary.errorCount += 1;
        events.push({
          machineId,
          nist_event_code: id,
          event_type: mapped?.eventType ?? null,
          use: mapped?.use ?? null,
          disposition: disposition as Disposition,
        });
      });
      if (machineId !== undefined) machines.push({ machineId, ...summary, unmappedCodes: [...unmapped].sort() });
    });
  }
  machines.sort((a, b) => a.machineId.localeCompare(b.machineId));
  return p.done({ format, electionId, machines, events });
}
