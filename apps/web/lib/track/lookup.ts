import "server-only";

// Looks up one ballot for the public tracker. Server-only: reads PostgREST with the publishable key,
// like lib/product-db.ts, and only from the public surface: ballot_public, ballot_event_public,
// precincts and stage_records. Never private.* and nothing new in the Data API
// (supabase/migrations/20261107200000_private_base_tables.sql; CLAUDE.md).
//
// Returns null for an unknown code and for any failure alike, so the caller can't tell them apart.
// Never logs the code.
import {
  type BallotStatus,
  buildTrackTimeline,
  isBallotStatus,
  isTerminal,
  PUBLISHED_STAGES,
  type PublicEvent,
  publicLabel,
  sortStageRecords,
} from "@vbt/domain";
import { isIsoDate, toIndianaDate } from "./dates";
import { defaultIntegrity, type IntegrityChecker, type RecordReader, safeCheck, type StageRecordRef } from "./integrity";
import type { TrackResult, TrackStage } from "./types";

export interface LookupDeps {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
  checker?: IntegrityChecker;
  records?: RecordReader;
}

class LookupFailed extends Error {}

/** A PostgREST double-quoted value, so ids with reserved characters stay one value. */
const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export async function lookupBallot(code: string, deps: LookupDeps = {}): Promise<TrackResult | null> {
  const env = deps.env ?? process.env;
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const doFetch = deps.fetch ?? fetch;
  const checker = deps.checker ?? defaultIntegrity.checker;
  const records = deps.records ?? defaultIntegrity.records;

  const read = async (path: string): Promise<Record<string, unknown>[]> => {
    const response = await doFetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new LookupFailed();
    const rows = (await response.json()) as unknown;
    if (!Array.isArray(rows) || !rows.every((r) => typeof r === "object" && r !== null)) throw new LookupFailed();
    return rows as Record<string, unknown>[];
  };

  try {
    const ballots = await read(
      `ballot_public?select=id,tracking_code,ciphertext_hash,precinct_id,cast_date,current_status` +
        `&tracking_code=eq.${encodeURIComponent(code)}&limit=2`,
    );
    if (ballots.length !== 1) return null;
    const ballot = ballots[0]!;
    const ballotId = str(ballot.id);
    const precinctId = str(ballot.precinct_id);
    const ciphertextHash = str(ballot.ciphertext_hash);
    const status = ballot.current_status;
    if (!ballotId || !precinctId || !ciphertextHash || !isBallotStatus(status) || ballot.tracking_code !== code) {
      return null;
    }

    const [eventRows, precinctRows] = await Promise.all([
      read(
        `ballot_event_public?select=event_type,from_status,to_status,reason,occurred_on,prev_hash,hash` +
          `&ballot_id=eq.${encodeURIComponent(ballotId)}`,
      ),
      read(`precincts?select=id,county_id,name&id=eq.${encodeURIComponent(precinctId)}`),
    ]);
    const precinctRow = precinctRows[0];
    const countyId = str(precinctRow?.county_id);
    if (precinctRows.length !== 1 || !countyId) return null;
    const precinct = { id: precinctId, name: str(precinctRow!.name) ?? precinctId, countyId };

    const castDate = isIsoDate(ballot.cast_date) ? ballot.cast_date : null;
    const timeline = buildTrackTimeline(eventRows.map(toPublicEvent), castDate);

    const reached = PUBLISHED_STAGES.filter((stage) => timeline.some((entry) => entry.status === stage));
    const stages = reached.length === 0 ? [] : await readStages(read, reached, precinct, checker, records, code, ciphertextHash);

    return {
      trackingCode: code,
      status,
      label: publicLabel(status),
      terminal: isTerminal(status),
      ciphertextHash,
      castDate,
      precinct,
      timeline,
      stages,
    };
  } catch {
    return null;
  }
}

/** Parses one ballot_event_public row. Missing text fields become empty or null. */
function toPublicEvent(r: Record<string, unknown>): PublicEvent {
  return {
    event_type: str(r.event_type) ?? "",
    from_status: str(r.from_status),
    to_status: str(r.to_status),
    reason: str(r.reason),
    occurred_on: str(r.occurred_on),
    prev_hash: str(r.prev_hash),
    hash: str(r.hash) ?? "",
  };
}

async function readStages(
  read: (path: string) => Promise<Record<string, unknown>[]>,
  reached: readonly BallotStatus[],
  precinct: { id: string; countyId: string },
  checker: IntegrityChecker,
  records: RecordReader,
  trackingCode: string,
  ciphertextHash: string,
): Promise<TrackStage[]> {
  const rows = await read(
    `stage_records?select=scope,scope_id,stage,merkle_root,signature,published_at` +
      `&stage=in.(${reached.join(",")})` +
      `&scope_id=in.(${encodeURIComponent([precinct.id, precinct.countyId].map(quote).join(","))})`,
  );

  const refs: StageRecordRef[] = [];
  for (const r of rows) {
    const stage = r.stage;
    const scope = r.scope;
    const scopeId = str(r.scope_id);
    const merkleRoot = str(r.merkle_root);
    if (!isBallotStatus(stage) || !reached.includes(stage) || !merkleRoot || !scopeId) continue;
    const ours =
      (scope === "precinct" && scopeId === precinct.id) || (scope === "county" && scopeId === precinct.countyId);
    if (!ours) continue;
    refs.push({ stage, scope, scopeId, merkleRoot, signature: str(r.signature), publishedOn: toIndianaDate(r.published_at) });
  }
  return Promise.all(
    sortStageRecords(refs).map(async (record) => ({
      ...record,
      recordUrl: records.recordUrl(record),
      check: await safeCheck(checker, { trackingCode, ciphertextHash, record }),
    })),
  );
}
