import { mismatchReportScope, OFFICIAL_ROLES } from "@vbt/domain";
import { readMismatchReport } from "../../../../lib/mismatch-report";
import { withServiceRoleReadOnly } from "../../../../lib/private-db";
import { forbidden, parseTarget, requireRole } from "../../../../lib/require-role";

// GET /api/reports/mismatches[?precinct=<id> | ?county=<id>] (T-11).
// Officials only (poll worker, county, state) with an aal2 session (lib/require-role.ts). Without a
// target the report covers the official's own scope; a target must be inside it. Lists the ballots
// flagged in a mismatch, grouped by precinct, with dates only. Anything refused is 403; an authorized
// request whose database is unavailable is 503 with no detail.
export async function GET(request: Request): Promise<Response> {
  const target = parseTarget(new URL(request.url).searchParams);
  if (target === null) return forbidden();
  const auth = await requireRole(request, OFFICIAL_ROLES, target);
  if (!auth.ok) return auth.response;
  const headers = { "cache-control": "no-store" };
  try {
    const scope = mismatchReportScope(auth.official, target);
    const report = await withServiceRoleReadOnly((db) => readMismatchReport(db, scope));
    return Response.json(report, { headers });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
