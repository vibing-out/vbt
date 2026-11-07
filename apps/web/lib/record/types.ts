// The published stage record, as GET /api/record/{scope}/{stage} returns it and /record shows it
// (docs/locked-interfaces.md § API boundaries; the T-15 "Public JSON shapes" refinement on main).
// `{scope}` in the path is the record's scope_id. Dates only: no field holds a time or a sequence,
// and the ballot list is in ciphertext-hash order, never casting order.
import type { BallotStatus } from "@vbt/domain";

export type RecordScope = "precinct" | "county";

/** Each published stage and the scope it is batched per. */
export const STAGE_SCOPE = {
  TALLIED_PRECINCT: "precinct",
  REPORTED_UNOFFICIAL: "county",
  CERTIFIED: "county",
  CHALLENGED: "county",
  DISCARDED: "county",
} as const satisfies Partial<Record<BallotStatus, RecordScope>>;

export type RecordStage = keyof typeof STAGE_SCOPE;

/** Display order on /record: the order a ballot moves through them. */
export const RECORD_STAGES = Object.keys(STAGE_SCOPE) as RecordStage[];

/** Safe as a URL path segment, a file name and an HTML id (the verifier uses the same rule). */
export const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type ContestTotals = Record<string, Record<string, number>>;

export interface PublishedBallot {
  tracking_code: string;
  ciphertext_hash: string;
}

/** The record without its ballot list: what /record shows for each entry. */
export interface RecordSummary {
  scope: RecordScope;
  scope_id: string;
  stage: RecordStage;
  merkle_root: string;
  ballot_count: number;
  totals: ContestTotals;
  /** "YYYY-MM-DD" in election-office time, never a time of day. */
  published_on: string;
  /** Lowercase hex Ed25519 signature (128 characters). */
  signature: string;
}

/** One entry on /record: a record and the county it belongs to. */
export interface PublishedRecordListing {
  record: RecordSummary;
  /** The record's own scope_id for a county record, or its precinct's county. */
  countyId: string;
}

/** The full JSON body of GET /api/record/{scope}/{stage}. */
export interface PublishedRecord extends RecordSummary {
  ballots: PublishedBallot[];
}

export function isRecordStage(value: unknown): value is RecordStage {
  return typeof value === "string" && Object.hasOwn(STAGE_SCOPE, value);
}

export function isScopeId(value: unknown): value is string {
  return typeof value === "string" && SCOPE_ID.test(value);
}
