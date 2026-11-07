import "server-only";

// GET /api/record/{scope}/{stage}: one published stage record, in the public JSON shape of
// docs/locked-interfaces.md § "Public JSON shapes" (on main; the shape tools/verifier parses).
//
// Read-only and unauthenticated. It reads PostgREST with the publishable key, and only the public
// surface: stage_records (RLS shows published rows only), ballot_event_public, ballot_public and
// precincts. Never private.*, never the service key, nothing new in the Data API.
//
// The body holds the record's own fields plus each listed ballot's tracking code and ciphertext hash.
// Never a ciphertext, a ballot or event id, a time, a leaf index or any voter identity: the record is
// dated (published_on) and its ballots are sorted by ciphertext hash, never by casting order.
//
// Which ballots a record lists. stage_records.id is the batch id, and each ballot's STATUS_CHANGE event
// into the stage carries that batch_id, but batch_id is private. Until the database offers a public
// read of a record's members, membership is taken from the public events: the ballots with an event
// into the stage within the record's precinct or county, where @vbt/domain's stageMemberEventTypes says
// which event types count (STATUS_CHANGE; for CHALLENGED also MISMATCH_DETECTED). That is exact while a scope
// has one record per stage. When it is not (more than one record, or a count that disagrees with
// ballot_count) the route answers 503 rather than serve a list that might not be the record's.
import { stageMemberEventTypes } from "@vbt/domain";
import { decodeStandardBase64, sortStageLeaves } from "@vbt/events";

/** The published stages and the scope each is batched per (locked-interfaces § Public JSON shapes). */
export const RECORD_STAGES = {
  TALLIED_PRECINCT: "precinct",
  REPORTED_UNOFFICIAL: "county",
  CERTIFIED: "county",
  CHALLENGED: "county",
  DISCARDED: "county",
} as const;

export type RecordStage = keyof typeof RECORD_STAGES;
export type RecordScope = (typeof RECORD_STAGES)[RecordStage];

/** A scope id that is safe as a URL path segment and a file name (the verifier's rule). */
export const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const HEX_32 = /^[0-9a-f]{64}$/;
const HEX_64 = /^[0-9a-f]{128}$/;
const SIGNATURE_BYTES = 64;

export type PublishedBallot = { tracking_code: string; ciphertext_hash: string };

export type ContestTotals = Record<string, Record<string, number>>;

export type PublishedRecord = {
  scope: RecordScope;
  scope_id: string;
  stage: RecordStage;
  merkle_root: string;
  ballot_count: number;
  totals: ContestTotals;
  published_on: string;
  signature: string;
  ballots: PublishedBallot[];
};

/** The record exists but cannot be served faithfully right now (a read failed or the data disagrees). */
export class RecordUnavailable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "RecordUnavailable";
  }
}

export interface StageRecordSource {
  /** The published record, or null when none is published. Throws RecordUnavailable. */
  read(scope: RecordScope, scopeId: string, stage: RecordStage): Promise<PublishedRecord | null>;
}

export const isRecordStage = (value: string): value is RecordStage => Object.hasOwn(RECORD_STAGES, value);

// ---------------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------------

const NO_STORE = { "Cache-Control": "no-store" } as const;

export const NOT_FOUND_BODY = Object.freeze({ error: "not_found" });
export const UNAVAILABLE_BODY = Object.freeze({ error: "record_unavailable" });
export const MISCONFIGURED_BODY = Object.freeze({ error: "server_misconfigured" });

const json = (body: unknown, status: number) => Response.json(body, { status, headers: NO_STORE });

/**
 * 200 with the record; 404 for an unknown stage, a malformed or unknown scope id, or a stage not
 * published yet (one identical body for all); 503 when the record can't be served faithfully; 500 when
 * the server has no database settings. Error bodies never echo the request or database details.
 */
export async function handleRecordRequest(
  rawScope: string,
  rawStage: string,
  source: StageRecordSource | null,
): Promise<Response> {
  if (!isRecordStage(rawStage) || !SCOPE_ID.test(rawScope)) return json(NOT_FOUND_BODY, 404);
  if (!source) return json(MISCONFIGURED_BODY, 500);
  try {
    const record = await source.read(RECORD_STAGES[rawStage], rawScope, rawStage);
    return record ? json(record, 200) : json(NOT_FOUND_BODY, 404);
  } catch {
    return json(UNAVAILABLE_BODY, 503);
  }
}

// ---------------------------------------------------------------------------------------------------
// The PostgREST source (publishable key, public surface only)
// ---------------------------------------------------------------------------------------------------

type Env = Readonly<Record<string, string | undefined>>;
type Row = Record<string, unknown>;

/** Rows per request; PostgREST's default max-rows is 1000, so a page never comes back cut short. */
export const PAGE_SIZE = 1000;
/** Ids per `in.(...)` filter, which keeps every URL well under common length limits. */
export const ID_CHUNK = 50;
/** A ceiling on pages per read (200,000 rows), so a runaway read fails instead of looping. */
const MAX_PAGES = 200;

/** A PostgREST double-quoted value, so ids with reserved characters stay one value. */
const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const inList = (values: readonly string[]) => encodeURIComponent(`(${values.map(quote).join(",")})`);
const eq = (value: string) => encodeURIComponent(`eq.${value}`);

const chunks = <T>(values: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
};

const isObj = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

const electionDate = new Intl.DateTimeFormat("en-CA", {
  // The election-office time zone, the same literal the database uses for ballot_events.occurred_on.
  timeZone: "America/Indiana/Indianapolis",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** published_at cut to its YYYY-MM-DD date; null unless it is a valid instant no later than `now`. */
function publishedOn(value: unknown, now: Date): string | null {
  if (typeof value !== "string") return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime()) || instant.getTime() > now.getTime()) return null;
  const date = electionDate.format(instant);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** The signature as 128 lowercase hex. The database stores T-05's standard base64; hex passes through. */
export function signatureHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (HEX_64.test(value)) return value;
  const bytes = decodeStandardBase64(value);
  if (!bytes || bytes.length !== SIGNATURE_BYTES) return null;
  return Buffer.from(bytes).toString("hex");
}

/** Aggregate totals, contest → choice → count. Built on null-prototype objects so no key is special. */
export function parseTotals(value: unknown): ContestTotals | null {
  if (!isObj(value)) return null;
  const totals: ContestTotals = Object.create(null);
  for (const [contest, row] of Object.entries(value)) {
    if (!isObj(row)) return null;
    const counts: Record<string, number> = Object.create(null);
    for (const [choice, count] of Object.entries(row)) {
      if (typeof count !== "number" || !Number.isFinite(count)) return null;
      counts[choice] = count;
    }
    totals[contest] = counts;
  }
  return totals;
}

/** The record source, or null when the server has no Supabase URL or publishable key. */
export function postgrestRecordSource(
  env: Env = process.env,
  fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
  now: () => Date = () => new Date(),
): StageRecordSource | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;

  const read = async (path: string): Promise<Row[]> => {
    let response: Response;
    try {
      response = await fetchImpl(`${url}/rest/v1/${path}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
        cache: "no-store",
      });
    } catch {
      throw new RecordUnavailable("network error");
    }
    if (!response.ok) throw new RecordUnavailable("database read failed");
    let rows: unknown;
    try {
      rows = await response.json();
    } catch {
      throw new RecordUnavailable("database read was not JSON");
    }
    if (!Array.isArray(rows) || !rows.every(isObj)) throw new RecordUnavailable("database read was not rows");
    return rows;
  };

  /** Every row of a query, a page at a time. `path` must carry a total `order`. */
  const readAll = async (path: string): Promise<Row[]> => {
    const all: Row[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await read(`${path}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`);
      all.push(...rows);
      if (rows.length < PAGE_SIZE) return all;
    }
    throw new RecordUnavailable("too many rows");
  };

  return {
    async read(scope, scopeId, stage) {
      const rows = await read(
        `stage_records?select=scope,scope_id,stage,merkle_root,ballot_count,totals,published_at,signature` +
          `&scope=${eq(scope)}&scope_id=${eq(scopeId)}&stage=${eq(stage)}&limit=2`,
      );
      if (rows.length === 0) return null;
      if (rows.length > 1) throw new RecordUnavailable("more than one record for this scope and stage");
      const row = rows[0]!;
      if (row.scope !== scope || row.scope_id !== scopeId || row.stage !== stage) {
        throw new RecordUnavailable("record does not match the request");
      }

      const merkleRoot = str(row.merkle_root);
      const ballotCount = row.ballot_count;
      const totals = parseTotals(row.totals);
      const signature = signatureHex(row.signature);
      const date = publishedOn(row.published_at, now());
      if (!merkleRoot || !HEX_32.test(merkleRoot)) throw new RecordUnavailable("merkle_root");
      if (typeof ballotCount !== "number" || !Number.isSafeInteger(ballotCount) || ballotCount < 0) {
        throw new RecordUnavailable("ballot_count");
      }
      if (!totals) throw new RecordUnavailable("totals");
      if (!signature) throw new RecordUnavailable("signature");
      // RLS already hides unpublished rows; a row dated in the future is treated the same way.
      if (!date) return null;

      const ballots = await readMembers(scope, scopeId, stage);
      if (ballots.length !== ballotCount) throw new RecordUnavailable("ballot list does not match ballot_count");

      return {
        scope,
        scope_id: scopeId,
        stage,
        merkle_root: merkleRoot,
        ballot_count: ballotCount,
        totals,
        published_on: date,
        signature,
        ballots,
      };
    },
  };

  /** The ballots that moved into `stage` within the scope, as {tracking_code, ciphertext_hash}, leaf order. */
  async function readMembers(scope: RecordScope, scopeId: string, stage: RecordStage): Promise<PublishedBallot[]> {
    const scopeColumn = scope === "precinct" ? "precinct_id" : "county_id";
    // Which event types count as a move into the stage is a domain rule (@vbt/domain stageMemberEventTypes).
    const memberTypes = stageMemberEventTypes(stage);
    if (memberTypes.length === 0) throw new RecordUnavailable("stage has no member events");
    const events = await readAll(
      `ballot_event_public?select=ballot_id` +
        `&event_type=in.${inList(memberTypes)}&to_status=${eq(stage)}&${scopeColumn}=${eq(scopeId)}` +
        `&order=hash.asc,id.asc`,
    );
    const memberIds = new Set<string>();
    for (const e of events) {
      const id = str(e.ballot_id);
      if (!id) throw new RecordUnavailable("event without a ballot");
      memberIds.add(id);
    }
    if (memberIds.size === 0) return [];

    const precinctIds =
      scope === "precinct"
        ? [scopeId]
        : (await readAll(`precincts?select=id&county_id=${eq(scopeId)}&order=id.asc`)).map((p) => {
            const id = str(p.id);
            if (!id) throw new RecordUnavailable("precinct without an id");
            return id;
          });

    const found = new Map<string, PublishedBallot>();
    for (const group of chunks(precinctIds, ID_CHUNK)) {
      const rows = await readAll(
        `ballot_public?select=id,tracking_code,ciphertext_hash&precinct_id=in.${inList(group)}` +
          `&order=ciphertext_hash.asc,id.asc`,
      );
      for (const b of rows) {
        const id = str(b.id);
        if (!id || !memberIds.has(id)) continue;
        const trackingCode = str(b.tracking_code);
        const ciphertextHash = str(b.ciphertext_hash);
        if (!trackingCode || !ciphertextHash || !HEX_32.test(ciphertextHash)) {
          throw new RecordUnavailable("ballot without a tracking code or ciphertext hash");
        }
        found.set(id, { tracking_code: trackingCode, ciphertext_hash: ciphertextHash });
      }
    }
    if (found.size !== memberIds.size) throw new RecordUnavailable("a member ballot is outside the scope");

    // Leaf order (ciphertext hash, then tracking code), the order T-05 built the tree in. Never cast order.
    return sortStageLeaves([...found.values()]).map((b) => ({
      tracking_code: b.tracking_code,
      ciphertext_hash: b.ciphertext_hash,
    }));
  }
}
