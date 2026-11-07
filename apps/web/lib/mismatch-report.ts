import "server-only";

import { groupMismatchesByPrecinct, isBallotStatus, type MismatchReport, type MismatchReportScope, type MismatchRow } from "@vbt/domain";
import type { Queryable } from "./private-db";

// The mismatch report's query (T-11): ballots flagged mismatched, with only the columns the report may
// show. Never prev_tracking_code, machine_id, ciphertext or any event time (locked principle 5).
const SQL = `
  select b.id::text as ballot_id,
         b.tracking_code,
         to_char(b.cast_date, 'YYYY-MM-DD') as cast_date,
         b.current_status,
         b.precinct_id,
         p.county_id,
         p.name as precinct_name
  from private.ballots b
  join public.precincts p on p.id = b.precinct_id
  where b.mismatch
    and ($1::text = 'all'
         or ($1 = 'precinct' and b.precinct_id = $2)
         or ($1 = 'county' and p.county_id = $2))
  order by b.precinct_id, b.tracking_code`;

function toRow(raw: unknown): MismatchRow {
  const r = raw as Record<string, unknown>;
  const text = (key: string) => {
    const value = r[key];
    if (typeof value !== "string") throw new Error(`mismatch report: unexpected ${key}`);
    return value;
  };
  const status = text("current_status");
  if (!isBallotStatus(status)) throw new Error("mismatch report: unexpected current_status");
  return {
    ballot_id: text("ballot_id"),
    tracking_code: text("tracking_code"),
    cast_date: text("cast_date"),
    current_status: status,
    precinct_id: text("precinct_id"),
    county_id: text("county_id"),
    precinct_name: text("precinct_name"),
  };
}

/** Flagged ballots in `scope`, grouped by precinct (packages/domain groupMismatchesByPrecinct). */
export async function readMismatchReport(db: Queryable, scope: MismatchReportScope): Promise<MismatchReport> {
  const { rows } = await db.query(SQL, [scope.scope, scope.scope === "all" ? null : scope.id]);
  return groupMismatchesByPrecinct(rows.map(toRow));
}
