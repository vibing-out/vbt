import { demoCountyId, isSetId } from "@vbt/demo";
import { startDemoRun } from "../../../../../lib/demo-run";
import { forbidden, requireRole } from "../../../../../lib/require-role";

// POST /api/official/demo/runs?set=<id> (T-22; approved by Austin on #49, docs/locked-interfaces.md).
// Starts the judges' 3-minute timeline on one demo set and streams each step as NDJSON. Only a state
// official, or a county official scoped to the set's own county, from an MFA (aal2) session. 409 when the
// set has already run. The target is computed from the set id with no I/O, so nothing runs before the guard.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The run takes 3 min 10 s at most; 240 s is under the 300 s limit on every Vercel plan.
export const maxDuration = 240;

export async function POST(request: Request): Promise<Response> {
  const sets = new URL(request.url).searchParams.getAll("set");
  const setId = sets[0];
  if (sets.length !== 1 || !isSetId(setId)) return forbidden();
  const auth = await requireRole(request, ["state", "county"], { scope: "county", id: demoCountyId(setId) });
  if (!auth.ok) return auth.response;
  return startDemoRun(request, setId);
}
