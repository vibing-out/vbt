// Mismatch on ingest (T-05 C18): an uploaded tracking code already exists with a different
// ciphertext hash, so two records of the same ballot disagree. The stored ciphertext is never
// overwritten. The ballot's chain gets MISMATCH_DETECTED (no status move), then, when the state
// machine allows current -> CHALLENGED, a STATUS_CHANGE to CHALLENGED (locked: a mismatch
// automatically creates a CHALLENGED transition). A ballot already CHALLENGED, or terminal, gets
// only the MISMATCH_DETECTED event. The transition rule comes from @vbt/domain, never from here.

import { type BallotStatus, transition } from "@vbt/domain";
import { type ChainedEvent, chainEvent } from "./chain.ts";

export const MISMATCH_REASON = "Records disagree; under review";

export type MismatchInput = {
  tracking_code: string;
  current_status: BallotStatus;
  /** Hash of the ballot's chain head (null if it has no events). */
  head_hash: string | null;
  /** Indiana date of detection, YYYY-MM-DD. */
  occurred_on: string;
};

export type MismatchPlan = {
  events: ChainedEvent[];
  /** The status the ballot moves to, or null when it keeps its status. */
  new_status: BallotStatus | null;
};

export function buildMismatchEvents(input: MismatchInput): MismatchPlan {
  const { tracking_code, current_status, head_hash, occurred_on } = input;
  const detected = chainEvent(
    { tracking_code, event_type: "MISMATCH_DETECTED", from_status: null, to_status: null, reason: MISMATCH_REASON, occurred_on },
    head_hash,
  );
  if (current_status === "CHALLENGED" || !transition({ from: current_status, to: "CHALLENGED" }).ok) {
    return { events: [detected], new_status: null };
  }
  const challenged = chainEvent(
    {
      tracking_code,
      event_type: "STATUS_CHANGE",
      from_status: current_status,
      to_status: "CHALLENGED",
      reason: MISMATCH_REASON,
      occurred_on,
    },
    detected.hash,
  );
  return { events: [detected, challenged], new_status: "CHALLENGED" };
}
