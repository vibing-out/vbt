import { OFFICIAL_ROLES } from "@vbt/domain";
import { badRequest, respond } from "../../../../lib/http";
import { mismatchReport } from "../../../../lib/mismatches";
import { forbidden, parseTarget, requireRole } from "../../../../lib/require-role";
import { serviceDb } from "../../../../lib/service-db";

// GET /api/reports/mismatches?precinct=<id> | ?county=<id> (T-09, locked API: mismatch list).
// Officials in scope, with MFA. Each row: ballot id, tracking code, precinct, machine, status, the check
// that failed and the date it was detected (never a time).
export async function GET(request: Request): Promise<Response> {
  const target = parseTarget(new URL(request.url).searchParams);
  if (target === null) return forbidden();
  const auth = await requireRole(request, OFFICIAL_ROLES, target);
  if (!auth.ok) return auth.response;

  if (!target) return badRequest("add ?precinct=<id> or ?county=<id>");
  try {
    return respond({ status: 200, body: { mismatches: await mismatchReport(target, serviceDb()) } });
  } catch {
    return respond({ status: 500, body: { error: "the mismatch report failed" } });
  }
}
