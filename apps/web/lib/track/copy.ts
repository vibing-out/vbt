// Plain-language wording for the public tracker. Stage labels come from @vbt/domain publicLabel()
// (locked state machine); the detail line under each stage follows docs/voter-journey.md
// § "What the tracker shows". The tracker collects nothing but the code (voter-journey § Design rules).
import type { BallotStatus } from "@vbt/domain";
import type { CheckState, TrackResult } from "./types";

/** The single message for an unknown, malformed or failed lookup: it never confirms a code exists. */
export const NOT_FOUND_MESSAGE = "We couldn't find a ballot with that code. Check the code on your receipt and try again.";

export const RECEIPT_FOOTER = "This code shows your ballot's progress. It does not show how you voted.";

export const REFRESH_FAILED = "Couldn't refresh — retrying";

export const CIPHERTEXT_LINE = "Encrypted ballot recorded";

export const CHECK_TEXT: Readonly<Record<CheckState, string>> = {
  passed: "Unchanged and included in this stage's public record",
  failed: "Check failed — this does not match the published record",
  unavailable: "Check not yet available",
};

/** The detail line under a stage, per voter-journey § "What the tracker shows". */
export function detailLine(status: BallotStatus, result: Pick<TrackResult, "precinct">): string {
  const { name, countyId } = result.precinct;
  switch (status) {
    case "CAST":
      return "Cast and sealed; encrypted ballot recorded.";
    case "TALLIED_PRECINCT":
      return `Counted at ${name}.`;
    case "REPORTED_UNOFFICIAL":
      return `Included in county ${countyId}'s election-night results.`;
    case "CERTIFIED":
      return `Included in county ${countyId}'s certified results.`;
    case "CHALLENGED":
      return "An election official is reviewing this ballot. If the review accepts it, it returns to its earlier stage; if not, it is not counted and the reason is shown.";
    case "DISCARDED":
      return "This ballot was not counted. The election office's reason is shown below.";
    case "SPOILED":
      return "This ballot was spoiled at the machine to check that the machine worked. It was not counted; the replacement ballot has its own code.";
  }
}

/** Shown on a stage reached again after a review accepted the ballot. */
export const REVIEW_ACCEPTED = "Review finished: the ballot was accepted and returned to this stage.";
