// GET /api/record/{scope}/{stage}: the published stage record as JSON (locked-interfaces § API
// boundaries). `{scope}` is the record's scope_id. No auth. 404 means not published (or an unknown
// scope id or stage); 503 means it couldn't be read. Error bodies never echo the request.
// The reader is injected so the route can be tested without the network.
import { isRecordStage, type RecordStage } from "@vbt/domain";
import { isScopeId, type PublishedRecord } from "./types";

export const NOT_PUBLISHED_BODY = Object.freeze({ error: "not_found", message: "No record is published for this stage yet." });
export const UNAVAILABLE_BODY = Object.freeze({ error: "unavailable", message: "The published record couldn't be loaded. Try again later." });

export interface RecordHandlerDeps {
  read: (scopeId: string, stage: RecordStage) => Promise<PublishedRecord | null>;
}

const HEADERS = { "Cache-Control": "no-store" };

export async function handleRecordRequest(scopeId: string, stage: string, deps: RecordHandlerDeps): Promise<Response> {
  if (!isScopeId(scopeId) || !isRecordStage(stage)) return Response.json(NOT_PUBLISHED_BODY, { status: 404, headers: HEADERS });
  let record: PublishedRecord | null;
  try {
    record = await deps.read(scopeId, stage);
  } catch {
    return Response.json(UNAVAILABLE_BODY, { status: 503, headers: HEADERS });
  }
  if (!record) return Response.json(NOT_PUBLISHED_BODY, { status: 404, headers: HEADERS });
  return Response.json(record, { status: 200, headers: HEADERS });
}
