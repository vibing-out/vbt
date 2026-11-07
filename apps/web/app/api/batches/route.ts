import { OFFICIAL_ROLES } from "@vbt/domain";
import { runBatch } from "../../../lib/batches";
import { getCrypto, keys } from "../../../lib/crypto";
import { badRequest, readUploadForm, respond } from "../../../lib/http";
import { forbidden, parseTarget, requireRole } from "../../../lib/require-role";
import { serviceDb } from "../../../lib/service-db";

// POST /api/batches?precinct=<id> | ?county=<id> (T-09, locked API: "Batch id, count; publishes a stage record").
// multipart/form-data: to_status (TALLIED_PRECINCT, REPORTED_UNOFFICIAL or CERTIFIED), expected_count (the
// number of ballots the official confirmed) and the cross-check files, each under its kind: machine_log
// (one per machine) and precinct_totals for a precinct tally; county_totals for election night;
// certified_totals for certification. Poll workers tally their own precinct; county and state officials
// run county batches in their scope (requireRole + @vbt/domain officialMayActOn). MFA always.
export async function POST(request: Request): Promise<Response> {
  const target = parseTarget(new URL(request.url).searchParams);
  if (!target) return forbidden();
  const auth = await requireRole(request, OFFICIAL_ROLES, target);
  if (!auth.ok) return auth.response;

  const form = await readUploadForm(request);
  if (!form) return badRequest("send multipart/form-data with to_status, expected_count and the files");
  const expected = form.fields.get("expected_count") ?? "";
  if (!/^\d{1,7}$/.test(expected)) return badRequest("expected_count must be the confirmed number of ballots");

  const outcome = await runBatch(
    auth.official,
    {
      target,
      to: form.fields.get("to_status") ?? "",
      expectedCount: Number(expected),
      files: form.files.map((f) => ({ kind: f.field, bytes: f.bytes })),
    },
    { crypto: getCrypto(), keys: () => keys(), db: serviceDb() },
  );
  return respond(outcome);
}
