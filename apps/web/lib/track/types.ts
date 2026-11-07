// The public tracker's response shape (GET /api/track/{code}), shared by the route and the page.
// Dates only: no field holds a time of day, an event id, a ballot id or any ciphertext.
import { type BallotStatus, isBallotStatus } from "@vbt/domain";

export type CheckState = "passed" | "failed" | "unavailable";

/** One stage's integrity check. `proof` is opaque here: packages/crypto (T-21) owns its format. */
export interface IntegrityCheck {
  state: CheckState;
  proof: unknown;
}

export interface TrackTimelineEntry {
  status: BallotStatus;
  label: string;
  /** "YYYY-MM-DD" in election-office time, or null if unknown. */
  date: string | null;
  /** The official's reason (CHALLENGED, DISCARDED), else null. */
  reason: string | null;
}

export interface TrackStage {
  stage: BallotStatus;
  scope: "precinct" | "county";
  scopeId: string;
  merkleRoot: string;
  signature: string | null;
  /** The record's publication date ("YYYY-MM-DD"), never its time. */
  publishedOn: string | null;
  /** Link to the published record, once GET /api/record exists; null until then. */
  recordUrl: string | null;
  check: IntegrityCheck;
}

export interface TrackResult {
  trackingCode: string;
  status: BallotStatus;
  label: string;
  terminal: boolean;
  ciphertextHash: string;
  castDate: string | null;
  precinct: { id: string; name: string; countyId: string };
  timeline: TrackTimelineEntry[];
  stages: TrackStage[];
}

/** Shape check for a response body arriving from the network. */
export function isTrackResult(value: unknown): value is TrackResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const precinct = v.precinct as Record<string, unknown> | null | undefined;
  return (
    typeof v.trackingCode === "string" &&
    isBallotStatus(v.status) &&
    typeof v.label === "string" &&
    typeof v.terminal === "boolean" &&
    typeof v.ciphertextHash === "string" &&
    typeof precinct === "object" &&
    precinct !== null &&
    typeof precinct.name === "string" &&
    typeof precinct.countyId === "string" &&
    Array.isArray(v.timeline) &&
    v.timeline.every((e) => typeof e === "object" && e !== null && isBallotStatus((e as { status?: unknown }).status)) &&
    Array.isArray(v.stages) &&
    v.stages.every((s) => typeof s === "object" && s !== null && isBallotStatus((s as { stage?: unknown }).stage))
  );
}
