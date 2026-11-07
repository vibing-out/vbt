// Groups the published records by county for /record: counties by id, and within a county by stage
// (the order a ballot moves through them), then by scope id. Never by publication time.
import { type PublishedRecordListing, RECORD_STAGES, type RecordSummary } from "./types";

export interface CountyRecords {
  countyId: string;
  records: RecordSummary[];
}

export function groupByCounty(listing: readonly PublishedRecordListing[]): CountyRecords[] {
  const byCounty = new Map<string, RecordSummary[]>();
  for (const { countyId, record } of listing) {
    const list = byCounty.get(countyId) ?? [];
    list.push(record);
    byCounty.set(countyId, list);
  }
  return [...byCounty.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([countyId, records]) => ({
      countyId,
      records: records.sort(
        (a, b) => RECORD_STAGES.indexOf(a.stage) - RECORD_STAGES.indexOf(b.stage) || a.scope_id.localeCompare(b.scope_id),
      ),
    }));
}
