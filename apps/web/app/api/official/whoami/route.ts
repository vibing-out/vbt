import { OFFICIAL_ROLES } from "@vbt/domain";
import { forbidden, parseTarget, requireRole } from "../../../../lib/require-role";

// GET /api/official/whoami[?precinct=<id> | ?county=<id>] (T-20 probe route).
// Any official (poll worker, county, state) with an aal2 session gets 200 and only their own grant;
// with a target, 200 only when their scope covers it. Everything else is 403 (lib/require-role.ts).
export async function GET(request: Request): Promise<Response> {
  const target = parseTarget(new URL(request.url).searchParams);
  if (target === null) return forbidden();
  const auth = await requireRole(request, OFFICIAL_ROLES, target);
  if (!auth.ok) return auth.response;
  const { role, scope, scopeId } = auth.official;
  return Response.json({ role, scope, scope_id: scopeId }, { headers: { "cache-control": "no-store" } });
}
