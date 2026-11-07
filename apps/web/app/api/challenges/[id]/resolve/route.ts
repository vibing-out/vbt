import { resolveChallenge } from "../../../../../lib/challenges";
import { badRequest, respond } from "../../../../../lib/http";
import { forbidden, requireRole } from "../../../../../lib/require-role";
import { serviceDb } from "../../../../../lib/service-db";

// POST /api/challenges/{ballot id}/resolve (T-09, locked API: returns the new status).
// JSON { "decision": "accepted" | "rejected", "reason": "..." }; a reason is required to reject.
// County and state officials only, with MFA; the ballot's precinct must be in their scope, else 403.
const ROLES = ["county", "state"] as const;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requireRole(request, ROLES);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("send JSON with decision and reason");
  }
  if (typeof body !== "object" || body === null) return badRequest("send JSON with decision and reason");
  const { decision, reason } = body as Record<string, unknown>;
  const { id } = await context.params;
  const outcome = await resolveChallenge(auth.official, id, { decision, reason }, serviceDb());
  if (outcome.status === 403) return forbidden();
  return respond(outcome);
}
