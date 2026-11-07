// Published stage records: which stages publish a record, and the scope each is batched per.
// Source: docs/locked-interfaces.md § Ballot status state machine and § API boundaries
// (GET /api/record/{scope}/{stage}).

import type { BallotStatus } from "./status.ts";
import type { BatchScope } from "./transition.ts";

/** Each published stage and the scope it is batched per, in the order a ballot moves through them. */
export const STAGE_SCOPE = Object.freeze({
  TALLIED_PRECINCT: "precinct",
  REPORTED_UNOFFICIAL: "county",
  CERTIFIED: "county",
  CHALLENGED: "county",
  DISCARDED: "county",
} as const satisfies Partial<Record<BallotStatus, BatchScope>>);

export type RecordStage = keyof typeof STAGE_SCOPE;

export function isRecordStage(value: unknown): value is RecordStage {
  return typeof value === "string" && Object.hasOwn(STAGE_SCOPE, value);
}
