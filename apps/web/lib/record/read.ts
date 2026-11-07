import "server-only";

// Reads published stage records for GET /api/record/{scope}/{stage} and the /record page.
//
// STUB (T-08b): T-05a (#148) owns the real GET /api/record route. Until it lands on epic/5, this
// minimal reader stands behind the locked interface. Like lib/track/lookup.ts it reads PostgREST with
// the publishable key, and only the public surface: stage_records, precincts, ballot_public and
// ballot_event_public. Never private.*, and nothing new in the Data API.
//
// A record's ballot list is rebuilt from the public events: the ballots with a STATUS_CHANGE into the
// record's stage in its precinct or county. If that list does not match the record's ballot_count
// (say a scope published the same stage twice), the record is reported unavailable rather than
// served with a wrong list. Never logs anything.
import { toIndianaDate } from "../track/dates";
import {
  type ContestTotals,
  isRecordStage,
  isScopeId,
  type PublishedBallot,
  type PublishedRecord,
  type PublishedRecordListing,
  type RecordScope,
  type RecordStage,
  type RecordSummary,
  STAGE_SCOPE,
} from "./types";

export interface RecordReadDeps {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
}

/** The read failed, or the record can't be rebuilt from the public surface. */
export class RecordUnavailableError extends Error {
  constructor() {
    super("the published record is unavailable");
    this.name = "RecordUnavailableError";
  }
}

/** One page of a PostgREST read; reads page until a short page comes back. */
export const PAGE_SIZE = 1000;
/** Ids per `in.(...)` filter, so request URLs stay short. */
const IN_CHUNK = 100;

const HEX_32 = /^[0-9a-f]{64}$/;
const HEX_64 = /^[0-9a-f]{128}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

type Row = Record<string, unknown>;
type Reader = (path: string) => Promise<Row[]>;

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const inList = (values: readonly string[]) => encodeURIComponent(`(${values.map(quote).join(",")})`);

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function reader(deps: RecordReadDeps): Reader | null {
  const env = deps.env ?? process.env;
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const doFetch = deps.fetch ?? fetch;

  return async (path) => {
    const all: Row[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const response = await doFetch(`${url}/rest/v1/${path}&limit=${PAGE_SIZE}&offset=${offset}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new RecordUnavailableError();
      const rows = (await response.json()) as unknown;
      if (!Array.isArray(rows) || !rows.every((r) => typeof r === "object" && r !== null)) throw new RecordUnavailableError();
      all.push(...(rows as Row[]));
      if (rows.length < PAGE_SIZE) return all;
    }
  };
}

/** Stored signatures are base64 (lib/batches.ts); the public record carries lowercase hex. */
export function signatureHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (HEX_64.test(value)) return value;
  if (!BASE64.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== value) return null;
  return bytes.toString("hex");
}

function isTotals(value: unknown): value is ContestTotals {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (row) =>
      typeof row === "object" &&
      row !== null &&
      !Array.isArray(row) &&
      Object.values(row).every((n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0),
  );
}

interface StageRow extends RecordSummary {
  /** Only to pick the latest of several rows; never leaves this module. */
  publishedAt: number;
}

/** A stage_records row as a public summary, or null if it isn't a well-formed published record. */
function toStageRow(r: Row): StageRow | null {
  const stage = r.stage;
  const scopeId = str(r.scope_id);
  const merkleRoot = str(r.merkle_root);
  const publishedOn = toIndianaDate(r.published_at);
  const signature = signatureHex(r.signature);
  const count = r.ballot_count;
  if (!isRecordStage(stage) || !isScopeId(scopeId) || r.scope !== STAGE_SCOPE[stage]) return null;
  if (!merkleRoot || !HEX_32.test(merkleRoot) || !publishedOn || !signature) return null;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || !isTotals(r.totals)) return null;
  return {
    scope: r.scope as RecordScope,
    scope_id: scopeId,
    stage,
    merkle_root: merkleRoot,
    ballot_count: count,
    totals: r.totals,
    published_on: publishedOn,
    signature,
    publishedAt: new Date(r.published_at as string).getTime(),
  };
}

/** One record per scope and stage: the latest published (ties broken by Merkle root, never by time). */
function latestPerScopeStage(rows: StageRow[]): Map<string, StageRow> {
  const byKey = new Map<string, StageRow>();
  for (const row of rows) {
    const key = `${row.scope_id}\u0000${row.stage}`;
    const held = byKey.get(key);
    if (!held || row.publishedAt > held.publishedAt || (row.publishedAt === held.publishedAt && row.merkle_root > held.merkle_root)) {
      byKey.set(key, row);
    }
  }
  return byKey;
}

function summary(row: StageRow): RecordSummary {
  const { scope, scope_id, stage, merkle_root, ballot_count, totals, published_on, signature } = row;
  return { scope, scope_id, stage, merkle_root, ballot_count, totals, published_on, signature };
}

const STAGE_COLUMNS = "select=scope,scope_id,stage,merkle_root,ballot_count,totals,signature,published_at";

/**
 * Every published stage record, one per scope and stage, with its county. Returns null when the
 * database isn't configured; throws RecordUnavailableError when a read fails.
 */
export async function listPublishedRecords(deps: RecordReadDeps = {}): Promise<PublishedRecordListing[] | null> {
  const read = reader(deps);
  if (!read) return null;
  const [stageRows, precinctRows] = await Promise.all([
    read(`stage_records?${STAGE_COLUMNS}&order=id`),
    read(`precincts?select=id,county_id&order=id`),
  ]);
  const countyOf = new Map(precinctRows.map((p) => [str(p.id), str(p.county_id)]));
  const rows = stageRows.map(toStageRow).filter((r): r is StageRow => r !== null);
  const listing: PublishedRecordListing[] = [];
  for (const row of latestPerScopeStage(rows).values()) {
    const countyId = row.scope === "county" ? row.scope_id : countyOf.get(row.scope_id);
    if (countyId) listing.push({ record: summary(row), countyId });
  }
  return listing;
}

/**
 * The full published record for one scope id and stage, or null when none is published (or the
 * database isn't configured). Throws RecordUnavailableError when a read fails or the ballot list
 * can't be rebuilt to match the record.
 */
export async function readPublishedRecord(
  scopeId: string,
  stage: RecordStage,
  deps: RecordReadDeps = {},
): Promise<PublishedRecord | null> {
  if (!isScopeId(scopeId) || !isRecordStage(stage)) return null;
  const read = reader(deps);
  if (!read) return null;
  const scope = STAGE_SCOPE[stage];
  const id = encodeURIComponent(scopeId);

  const rows = (await read(`stage_records?${STAGE_COLUMNS}&scope_id=eq.${id}&stage=eq.${stage}&order=id`))
    .map(toStageRow)
    .filter((r): r is StageRow => r !== null);
  const row = latestPerScopeStage(rows).values().next().value;
  if (!row) return null;

  const scopeColumn = scope === "precinct" ? "precinct_id" : "county_id";
  const events = await read(
    `ballot_event_public?select=ballot_id&event_type=eq.STATUS_CHANGE&to_status=eq.${stage}&${scopeColumn}=eq.${id}&order=hash,id`,
  );
  const members = new Set(events.map((e) => str(e.ballot_id)).filter((v): v is string => v !== null));
  if (members.size !== events.length || members.size !== row.ballot_count) throw new RecordUnavailableError();

  const precinctIds =
    scope === "precinct"
      ? [scopeId]
      : (await read(`precincts?select=id&county_id=eq.${id}&order=id`)).map((p) => str(p.id)).filter((v): v is string => v !== null);
  const ballotRows = (
    await Promise.all(
      chunks(precinctIds, IN_CHUNK).map((ids) =>
        read(`ballot_public?select=id,tracking_code,ciphertext_hash&precinct_id=in.${inList(ids)}&order=ciphertext_hash,id`),
      ),
    )
  ).flat();

  const ballots: PublishedBallot[] = [];
  for (const b of ballotRows) {
    const ballotId = str(b.id);
    if (!ballotId || !members.has(ballotId)) continue;
    const trackingCode = str(b.tracking_code);
    const ciphertextHash = str(b.ciphertext_hash);
    if (!trackingCode || !ciphertextHash || !HEX_32.test(ciphertextHash)) throw new RecordUnavailableError();
    ballots.push({ tracking_code: trackingCode, ciphertext_hash: ciphertextHash });
  }
  if (ballots.length !== row.ballot_count) throw new RecordUnavailableError();
  // Ascending ciphertext hash: the Merkle leaf order, never casting order.
  ballots.sort((a, b) => a.ciphertext_hash.localeCompare(b.ciphertext_hash) || a.tracking_code.localeCompare(b.tracking_code));

  return { ...summary(row), ballots };
}
