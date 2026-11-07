import "server-only";

import type { OfficialTarget } from "@vbt/domain";
import type { MismatchRow, ServiceDb } from "./service-db";

// GET /api/reports/mismatches (T-09): mismatched or challenged ballots in one precinct or county, for
// officials only. Machine ids are official data (locked § Cross-checks privacy rule); times are not needed,
// so the report carries the date a mismatch was detected and never a time or sequence.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function day(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const head = value.slice(0, 10);
  return DAY.test(head) ? head : null;
}

export async function mismatchReport(target: OfficialTarget, db: ServiceDb): Promise<MismatchRow[]> {
  const rows = await db.mismatches(target.scope, target.id);
  return rows.map((r) => ({
    ballot_id: r.ballot_id,
    tracking_code: r.tracking_code,
    precinct_id: r.precinct_id,
    machine_id: r.machine_id,
    current_status: r.current_status,
    reason: r.reason,
    detected_on: day(r.detected_on),
  }));
}
