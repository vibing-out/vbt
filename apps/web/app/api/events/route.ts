import type { OfficialRole } from "@vbt/domain";
import { ingestUpload, readUpload } from "../../../lib/ingest";
import { requireRole } from "../../../lib/require-role";

// POST /api/events (T-05): an official uploads one exported, encrypted ballot record as
// multipart/form-data with a single "file" field (format: @vbt/events record-file.ts). One-way: this
// route only receives files; nothing calls out to a voting system.
// Order (C24): size (413) -> parse (400/422) -> requireRole (403) -> semantic checks (422) -> one RPC.
// 201 { file_id, event_ids }; 409 for a file already uploaded or data that changed meanwhile.
export const runtime = "nodejs";

/** County officials for their own county; state officials for any county. */
const INGEST_ROLES: readonly OfficialRole[] = ["county", "state"];

export async function POST(request: Request): Promise<Response> {
  const read = await readUpload(request);
  if (!read.ok) return read.response;
  const auth = await requireRole(request, INGEST_ROLES, { scope: "county", id: read.upload.file.county_id });
  if (!auth.ok) return auth.response;
  return ingestUpload(read.upload, auth.official);
}
