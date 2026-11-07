// Links to a published stage record: the JSON (GET /api/record/{scope}/{stage}) and its entry on /record.
// Shared by the tracker's stage links, the /record page and the route, so they never disagree.
import { isRecordStage, isScopeId, type RecordStage } from "./types";

/** The record's JSON: the exact GET /api/record/{scope}/{stage} URL, where {scope} is the scope_id. */
export function recordApiUrl(scopeId: string, stage: RecordStage): string {
  return `/api/record/${encodeURIComponent(scopeId)}/${stage}`;
}

/** The HTML id of the record's entry on /record. */
export function recordAnchor(scopeId: string, stage: RecordStage): string {
  return `record-${scopeId}-${stage}`;
}

/** The record's entry on /record, or null for a stage or scope id that has no published record URL. */
export function recordPageUrl(scopeId: string, stage: string): string | null {
  if (!isScopeId(scopeId) || !isRecordStage(stage)) return null;
  return `/record#${recordAnchor(scopeId, stage)}`;
}

/** The file name the /record page saves a record's JSON under. */
export function recordFileName(scopeId: string, stage: RecordStage): string {
  return `${scopeId}-${stage}.json`;
}
