// The NIST SP 1500-101 Event.Id codes VBT reads, and what each one becomes. The codes are VotingWorks'
// documented ids (the locked reference for machine logs):
// https://github.com/votingworks/vxsuite/blob/main/libs/logging/VotingWorksLoggingDocumentation.md
// docs/nist-mapping.md lists every code here; a test keeps the two in step.
//
// Only `vote-cast` maps to a ballot event type, and even it never becomes a ballot_events row from a
// log: a CDF log names no ballot, and linking a tracking code to a timed machine event is forbidden
// (locked privacy rule). The CAST event comes from the ElectionGuard record; the log only counts.
// Any other Event.Id is reported in the import summary's unmappedCodes.

import { type EventType } from "./event-types.ts";

export type NistCodeUse =
  /** Counted per device for check C1. */
  | "ballot-count"
  | "polls-opened"
  | "polls-closed"
  /** Counted in the import summary's error_count. */
  | "error";

export type NistCode = {
  /** The vendor Event.Id, stored unchanged as ballot_events.nist_event_code where an event is written. */
  readonly code: string;
  readonly use: NistCodeUse;
  /** The ballot_events.event_type it corresponds to, or null for a machine-level code. */
  readonly eventType: EventType | null;
};

const code = (c: string, use: NistCodeUse, eventType: EventType | null = null): NistCode => Object.freeze({ code: c, use, eventType });

/** VxSuite error ids: every documented id ending in -error. */
const ERROR_CODES = [
  "admin-adjudication-proxy-error",
  "audio-device-detection-error",
  "audio-device-selection-error",
  "audio-playback-error",
  "audio-volume-change-error",
  "convert-log-cdf-log-line-error",
  "diagnostic-error",
  "file-read-error",
  "lifetime-sheet-count-increment-error",
  "lifetime-sheet-count-read-error",
  "parse-error",
  "pat-device-error",
  "socket-client-error",
  "socket-server-error",
  "unknown-error",
];

export const NIST_CODES: readonly NistCode[] = Object.freeze([
  code("vote-cast", "ballot-count", "CAST"),
  code("polls-opened", "polls-opened"),
  code("polls-closed", "polls-closed"),
  ...ERROR_CODES.map((c) => code(c, "error")),
]);

const BY_CODE: ReadonlyMap<string, NistCode> = new Map(NIST_CODES.map((c) => [c.code, c]));

/** The mapping for a vendor Event.Id, or undefined when VBT does not map it. */
export function lookupNistCode(eventId: string): NistCode | undefined {
  return BY_CODE.get(eventId);
}
