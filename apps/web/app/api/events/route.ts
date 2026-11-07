import { OFFICIAL_ROLES } from "@vbt/domain";
import { badRequest, readUploadForm, respond } from "../../../lib/http";
import { forbidden, parseTarget, requireRole } from "../../../lib/require-role";
import { serviceDb } from "../../../lib/service-db";
import { recordUpload } from "../../../lib/uploads";

// POST /api/events?precinct=<id> | ?county=<id> (T-09, locked API: "file hashes recorded"; returns the id).
// multipart/form-data: kind (machine_log, precinct_totals, county_totals or certified_totals) and one file.
// Any official in scope, with MFA. Returns { id, kind, scope_id, file_sha256 }.
export async function POST(request: Request): Promise<Response> {
  const target = parseTarget(new URL(request.url).searchParams);
  if (!target) return forbidden();
  const auth = await requireRole(request, OFFICIAL_ROLES, target);
  if (!auth.ok) return auth.response;

  const form = await readUploadForm(request);
  if (!form) return badRequest("send multipart/form-data with kind and one file");
  if (form.files.length !== 1 || form.files[0]!.field !== "file") return badRequest("upload exactly one file, as file");
  const outcome = await recordUpload(auth.official, target, { kind: form.fields.get("kind"), file: form.files[0]! }, serviceDb());
  return respond(outcome);
}
