// Mismatches: the events a flagged ballot gets, and the mismatch report's grouping and scope (T-11).
// Sources: docs/locked-interfaces.md § Ballot status state machine ("any disagreement ... moves the
// affected ballots to CHALLENGED"), § Event schema (MISMATCH_DETECTED, null from/to), § Cross-checks,
// and locked principle 5 (no ordering leaks: dates only, never a time or a cast sequence).
// No I/O: tools/scale-demo writes the events, apps/web reads the rows and asks for the grouping.

import type { OfficialGrant, OfficialTarget } from "./official.ts";
import type { BallotStatus } from "./status.ts";
import { transition } from "./transition.ts";

/** The reason both mismatch events carry. Public (ballot_event_public.reason): no ballot detail in it. */
export const MISMATCH_REASON = "Machine record differs from the scanned paper ballot";

export type MismatchEventStep =
  | { readonly eventType: "MISMATCH_DETECTED"; readonly from: null; readonly to: null; readonly reason: string }
  | { readonly eventType: "STATUS_CHANGE"; readonly from: BallotStatus; readonly to: "CHALLENGED"; readonly reason: string };

/**
 * The events a ballot found in a mismatch gets, in hash-chain order: MISMATCH_DETECTED, then the
 * STATUS_CHANGE that moves it to CHALLENGED. Throws when the state machine refuses that move (a
 * terminal or already challenged ballot), so nothing is written for it.
 */
export function mismatchEventPlan(from: BallotStatus): readonly MismatchEventStep[] {
  const result = transition({ from, to: "CHALLENGED" });
  if (!result.ok) throw new Error(`Cannot flag a mismatch: ${result.message}`);
  return [
    { eventType: "MISMATCH_DETECTED", from: null, to: null, reason: MISMATCH_REASON },
    { eventType: "STATUS_CHANGE", from, to: "CHALLENGED", reason: MISMATCH_REASON },
  ];
}

/** One flagged ballot as the report reads it. Only public-safe fields: no prev code, machine, time. */
export type MismatchRow = {
  readonly ballot_id: string;
  readonly tracking_code: string;
  /** YYYY-MM-DD only. */
  readonly cast_date: string;
  readonly current_status: BallotStatus;
  readonly precinct_id: string;
  readonly county_id: string;
  readonly precinct_name: string;
};

export type MismatchReportBallot = {
  readonly ballot_id: string;
  readonly tracking_code: string;
  readonly cast_date: string;
  readonly current_status: BallotStatus;
};

export type MismatchReportPrecinct = {
  readonly precinct_id: string;
  readonly county_id: string;
  readonly name: string;
  readonly count: number;
  readonly ballots: readonly MismatchReportBallot[];
};

export type MismatchReport = {
  readonly precincts: readonly MismatchReportPrecinct[];
  readonly total: number;
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Groups flagged ballots by precinct. Precincts sort by id and ballots by tracking code, both
 * non-temporal keys, so the report never lists ballots in cast order whatever order the rows came in.
 */
export function groupMismatchesByPrecinct(rows: readonly MismatchRow[]): MismatchReport {
  const groups = new Map<string, { precinct_id: string; county_id: string; name: string; ballots: MismatchReportBallot[] }>();
  for (const row of rows) {
    let group = groups.get(row.precinct_id);
    if (!group) {
      group = { precinct_id: row.precinct_id, county_id: row.county_id, name: row.precinct_name, ballots: [] };
      groups.set(row.precinct_id, group);
    }
    const { ballot_id, tracking_code, cast_date, current_status } = row;
    group.ballots.push({ ballot_id, tracking_code, cast_date, current_status });
  }
  const precincts = [...groups.values()]
    .sort((a, b) => byText(a.precinct_id, b.precinct_id))
    .map((group) => {
      const ballots = group.ballots.sort((a, b) => byText(a.tracking_code, b.tracking_code));
      return { ...group, count: ballots.length, ballots };
    });
  return { precincts, total: rows.length };
}

/** What a mismatch report covers: every county, one county or one precinct. */
export type MismatchReportScope =
  | { readonly scope: "all" }
  | { readonly scope: "county"; readonly id: string }
  | { readonly scope: "precinct"; readonly id: string };

/**
 * The report's scope for an official who already passed the role and target check (apps/web
 * requireRole + officialMayActOn): the requested target when there is one, otherwise the official's
 * own scope (their precinct, their county, or every county for state).
 */
export function mismatchReportScope(grant: OfficialGrant, target?: OfficialTarget): MismatchReportScope {
  if (target !== undefined) return { scope: target.scope, id: target.id };
  switch (grant.role) {
    case "poll_worker":
      return { scope: "precinct", id: grant.scopeId };
    case "county":
      return { scope: "county", id: grant.scopeId };
    case "state":
      return { scope: "all" };
  }
}
