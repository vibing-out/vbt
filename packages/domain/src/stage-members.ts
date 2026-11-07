// Which public events put a ballot into a stage record's ballot list.
//
// A stage record lists the ballots that moved into its stage within its scope. Most stages are reached
// only by a STATUS_CHANGE (a batch edge). CHALLENGED is reached two ways: an official's batch writes
// MISMATCH_DETECTED with to_status CHALLENGED for each ballot that failed a cross-check (T-09), and ingest
// writes MISMATCH_DETECTED with no status followed by STATUS_CHANGE into CHALLENGED (packages/events
// mismatch.ts). Both count; callers also match to_status = stage, so a status-less flag never counts.

import type { BallotStatus } from "./status.ts";

const STATUS_CHANGE_ONLY = Object.freeze(["STATUS_CHANGE"] as const);

const MEMBER_EVENT_TYPES: Readonly<Partial<Record<BallotStatus, readonly string[]>>> = Object.freeze({
  TALLIED_PRECINCT: STATUS_CHANGE_ONLY,
  REPORTED_UNOFFICIAL: STATUS_CHANGE_ONLY,
  CERTIFIED: STATUS_CHANGE_ONLY,
  CHALLENGED: Object.freeze(["STATUS_CHANGE", "MISMATCH_DETECTED"] as const),
  DISCARDED: STATUS_CHANGE_ONLY,
});

/**
 * The event types whose to_status = `stage` make a ballot a member of that stage's record. Empty for a
 * stage that publishes no record (CAST, SPOILED, or anything unknown).
 */
export function stageMemberEventTypes(stage: string): readonly string[] {
  return Object.hasOwn(MEMBER_EVENT_TYPES, stage) ? MEMBER_EVENT_TYPES[stage as BallotStatus]! : [];
}
