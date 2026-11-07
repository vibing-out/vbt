import "server-only";

import type { OfficialTarget } from "@vbt/domain";
import { failure, type Outcome } from "./batches";
import { IngestError, isUploadKind, KIND_SCOPE, parseUpload } from "./ingest";
import type { Official } from "./require-role";
import type { ServiceDb } from "./service-db";

// POST /api/events (T-09): an official uploads one exported file (a machine event log, or precinct,
// election-night or certified totals). It is parsed and checked, and its SHA-256 is recorded in
// private.uploads (locked API: "file hashes recorded"); the file itself is not stored. Uploading the same
// file again returns the same record. Ingest is one-way (locked principle 7): nothing calls a voting system.
// CVR ingest, which creates ballots, needs E3's encryption and is not part of T-09.

export interface UploadInput {
  kind: unknown;
  file: { bytes: Uint8Array } | null;
}

export async function recordUpload(official: Official, target: OfficialTarget, input: UploadInput, db: ServiceDb): Promise<Outcome> {
  try {
    const { kind } = input;
    if (!isUploadKind(kind)) return { status: 400, body: { error: "kind must be machine_log, precinct_totals, county_totals or certified_totals" } };
    if (KIND_SCOPE[kind] !== target.scope) return { status: 400, body: { error: `a ${kind} file is uploaded for a ${KIND_SCOPE[kind]}` } };
    if (!input.file) return { status: 400, body: { error: "upload exactly one file" } };

    let parsed;
    try {
      parsed = parseUpload(kind, target.id, input.file.bytes);
    } catch (error) {
      if (error instanceof IngestError) return { status: 400, body: { error: error.message } };
      throw error;
    }
    if (parsed.kind === "machine_log") {
      const machines = new Set(await db.precinctMachines(target.id));
      const outside = [...parsed.log.counts.keys()].filter((device) => !machines.has(device));
      if (outside.length > 0) return { status: 400, body: { error: `device ${outside[0]} is not a machine in ${target.id}` } };
    }

    const [row] = await db.recordUploads([{ file_sha256: parsed.sha256, kind, scope_id: target.id }], official.userId);
    if (!row) throw new Error("the upload was not recorded");
    return { status: 201, body: { id: row.id, kind: row.kind, scope_id: row.scope_id, file_sha256: row.file_sha256 } };
  } catch (error) {
    const outcome = failure(error);
    return outcome.status === 500 ? { status: 500, body: { error: "the upload failed; nothing was recorded" } } : outcome;
  }
}
