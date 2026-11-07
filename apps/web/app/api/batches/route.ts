import { OFFICIAL_ROLES } from "@vbt/domain";
import { MAX_BATCH_BODY_BYTES, parseBatchRequest, runBatch } from "../../../lib/batches";
import { requireRole } from "../../../lib/require-role";
import { jsonResponse } from "../../../lib/service-db";

// POST /api/batches (T-05): { scope, scope_id, from_status, to_status } moves every ballot in the
// precinct or county that holds from_status, in one transaction, and publishes a signed stage record.
// Poll workers for their precinct, county officials for their county, state officials anywhere.
// Order (C24): size (413) -> parse (400) -> requireRole (403) -> transition check (422) -> one RPC.
// 201 { batch_id, ballot_count, stage_record: { id, merkle_root, signature } }.
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BATCH_BODY_BYTES) {
    return jsonResponse(413, { error: "body_too_large" });
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }
  const body = parseBatchRequest(json);
  if (!body) return jsonResponse(400, { error: "expected { scope, scope_id, from_status, to_status }" });
  const auth = await requireRole(request, OFFICIAL_ROLES, { scope: body.scope, id: body.scope_id });
  if (!auth.ok) return auth.response;
  return runBatch(body, auth.official);
}
