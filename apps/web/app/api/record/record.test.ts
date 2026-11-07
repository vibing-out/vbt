import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  handleRecordRequest,
  ID_CHUNK,
  PAGE_SIZE,
  parseTotals,
  postgrestRecordSource,
  RECORD_STAGES,
  signatureHex,
  type StageRecordSource,
} from "./record";

// The route with its real wiring; only the network is faked. Global fetch is a small PostgREST double
// that understands the filters the source sends (eq., in.(...), select, limit, offset) and applies the
// stage_records RLS policy (published_at <= now()).
const { GET } = await import("./[scope]/[stage]/route");
const routeModule = await import("./[scope]/[stage]/route");

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://db.vbt.example",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
} as const;

type Row = Record<string, unknown>;
type Tables = Record<"stage_records" | "ballot_event_public" | "ballot_public" | "precincts", Row[]>;

const hex = (n: number, width = 64) => n.toString(16).padStart(width, "0");
const SIG_BYTES = Buffer.from(Array.from({ length: 64 }, (_, i) => i));
const SIG_BASE64 = SIG_BYTES.toString("base64");
const SIG_HEX = SIG_BYTES.toString("hex");
const ROOT = "ab".repeat(32);
const PUBLISHED_AT = "2026-11-04T02:30:00+00:00"; // 21:30 on Nov 3 in Indianapolis

/** Ballot n: random-looking ids, codes and hashes so neither id nor hash order is cast order. */
const ballot = (n: number, precinct: string) => ({
  id: `00000000-0000-4000-8000-${hex(n * 7919 + 13, 12)}`,
  tracking_code: `CODE-${String(n).padStart(4, "0")}`,
  ciphertext_hash: hex((n * 2654435761) % 4294967291),
  precinct_id: precinct,
  cast_date: "2026-11-03",
  current_status: "TALLIED_PRECINCT",
});

const event = (b: { id: string; precinct_id: string }, to: string, county = "18097", type = "STATUS_CHANGE") => ({
  id: `e-${b.id}-${to}-${type}`,
  ballot_id: b.id,
  precinct_id: b.precinct_id,
  county_id: county,
  event_type: type,
  from_status: "CAST",
  to_status: to,
  reason: null,
  occurred_on: "2026-11-03",
  prev_hash: hex(1),
  hash: hex(Number.parseInt(b.id.slice(-6), 16) + 99),
});

const TOTALS = { governor: { alice: 2, bob: 1 } };

function seeded(): Tables {
  const p1 = [1, 2, 3].map((n) => ballot(n, "18097-001"));
  const p2 = [4, 5].map((n) => ballot(n, "18097-002"));
  return {
    precincts: [
      { id: "18097-001", county_id: "18097", name: "Precinct 1" },
      { id: "18097-002", county_id: "18097", name: "Precinct 2" },
      { id: "18001-001", county_id: "18001", name: "Elsewhere" },
    ],
    ballot_public: [...p1, ...p2, ballot(6, "18001-001")],
    ballot_event_public: [
      ...p1.map((b) => event(b, "TALLIED_PRECINCT")),
      ...p2.map((b) => event(b, "TALLIED_PRECINCT")),
      // Only precinct 1's ballots moved on to election night, and the MISMATCH_DETECTED event is no batch.
      ...p1.map((b) => event(b, "REPORTED_UNOFFICIAL")),
      event(p2[0]!, "CHALLENGED", "18097", "MISMATCH_DETECTED"),
    ],
    stage_records: [
      record("precinct", "18097-001", "TALLIED_PRECINCT", 3),
      record("precinct", "18097-002", "TALLIED_PRECINCT", 2),
      record("county", "18097", "REPORTED_UNOFFICIAL", 3),
      // Not published yet: RLS hides it.
      { ...record("county", "18097", "CERTIFIED", 3), published_at: "2999-01-01T00:00:00+00:00" },
    ],
  };
}

function record(scope: string, scopeId: string, stage: string, count: number): Row {
  return {
    id: `r-${scopeId}-${stage}`,
    scope,
    scope_id: scopeId,
    stage,
    merkle_root: ROOT,
    ballot_count: count,
    totals: TOTALS,
    published_at: PUBLISHED_AT,
    signature: SIG_BASE64,
  };
}

/** Parses a PostgREST in.(...) list with double-quoted values. */
function parseIn(list: string): string[] {
  const inner = list.slice(1, -1);
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|([^,]+)/g;
  for (const m of inner.matchAll(re)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2]!);
  return out;
}

type Call = { url: URL; init: RequestInit | undefined };

function fakePostgrest(tables: Tables, options: { failOn?: string; now?: Date } = {}) {
  const calls: Call[] = [];
  const now = options.now ?? new Date("2026-11-07T12:00:00Z");
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const table = url.pathname.replace(/^\/rest\/v1\//, "") as keyof Tables;
    if (options.failOn === table) return new Response("boom", { status: 500 });
    let rows = [...(tables[table] ?? [])];
    if (table === "stage_records") rows = rows.filter((r) => new Date(String(r.published_at)) <= now);
    for (const [k, v] of url.searchParams) {
      if (["select", "order", "limit", "offset"].includes(k)) continue;
      if (v.startsWith("eq.")) rows = rows.filter((r) => String(r[k]) === v.slice(3));
      else if (v.startsWith("in.")) {
        const allowed = new Set(parseIn(v.slice(3)));
        rows = rows.filter((r) => allowed.has(String(r[k])));
      } else throw new Error(`unsupported filter ${k}=${v}`);
    }
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 1000);
    rows = rows.slice(offset, offset + Math.min(limit, 1000));
    const select = url.searchParams.get("select")?.split(",");
    const out = select ? rows.map((r) => Object.fromEntries(select.map((c) => [c, r[c]]))) : rows;
    return Response.json(out);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

let db: ReturnType<typeof fakePostgrest>;
const serveDb = (tables: Tables = seeded(), options: { failOn?: string; now?: Date } = {}) => {
  db = fakePostgrest(tables, options);
  vi.stubGlobal("fetch", db.fetch);
};

const call = (scope: string, stage: string, init?: RequestInit) =>
  GET(new Request(`https://vbt.example/api/record/${encodeURIComponent(scope)}/${encodeURIComponent(stage)}`, init), {
    params: Promise.resolve({ scope, stage }),
  });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV.NEXT_PUBLIC_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_must_not_be_used");
  serveDb();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// The verifier's parser rules (tools/verifier/src/record.ts on main), restated so this test fails if the
// route drifts from the shape the verifier reads.
const VERIFIER_KEYS = ["ballot_count", "ballots", "merkle_root", "published_on", "scope", "scope_id", "signature", "stage", "totals"];
function expectVerifierShape(body: Row) {
  expect(Object.keys(body).sort()).toEqual(VERIFIER_KEYS);
  expect(["precinct", "county"]).toContain(body.scope);
  expect(RECORD_STAGES[body.stage as keyof typeof RECORD_STAGES]).toBe(body.scope);
  expect(body.scope_id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
  expect(body.merkle_root).toMatch(/^[0-9a-f]{64}$/);
  expect(Number.isSafeInteger(body.ballot_count)).toBe(true);
  expect(body.published_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(body.signature).toMatch(/^[0-9a-f]{128}$/);
  const ballots = body.ballots as Row[];
  expect(ballots).toHaveLength(body.ballot_count as number);
  for (const b of ballots) {
    expect(Object.keys(b).sort()).toEqual(["ciphertext_hash", "tracking_code"]);
    expect(b.ciphertext_hash).toMatch(/^[0-9a-f]{64}$/);
  }
  const hashes = ballots.map((b) => b.ciphertext_hash as string);
  expect(hashes).toEqual([...hashes].sort());
}

// --- AC1: a published record, as JSON, in the verifier's shape --------------------------------------

test("AC1: a published precinct record returns 200 with codes, ciphertext hashes, root, totals, date and signature", async () => {
  const response = await call("18097-001", "TALLIED_PRECINCT");
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
  const body = (await response.json()) as Row;
  expectVerifierShape(body);
  const expected = [1, 2, 3]
    .map((n) => ballot(n, "18097-001"))
    .map((b) => ({ tracking_code: b.tracking_code, ciphertext_hash: b.ciphertext_hash }))
    .sort((a, b) => (a.ciphertext_hash < b.ciphertext_hash ? -1 : 1));
  expect(body).toEqual({
    scope: "precinct",
    scope_id: "18097-001",
    stage: "TALLIED_PRECINCT",
    merkle_root: ROOT,
    ballot_count: 3,
    totals: TOTALS,
    published_on: "2026-11-03",
    signature: SIG_HEX,
    ballots: expected,
  });
});

test("AC1: a published county record lists only the ballots that moved into that stage in the county", async () => {
  const response = await call("18097", "REPORTED_UNOFFICIAL");
  expect(response.status).toBe(200);
  const body = (await response.json()) as Row;
  expectVerifierShape(body);
  expect(body).toMatchObject({ scope: "county", scope_id: "18097", stage: "REPORTED_UNOFFICIAL", ballot_count: 3 });
  expect((body.ballots as Row[]).map((b) => b.tracking_code).sort()).toEqual(["CODE-0001", "CODE-0002", "CODE-0003"]);
});

test("AC1: a published CHALLENGED record returns 200, counting ballots moved by MISMATCH_DETECTED", async () => {
  const tables = seeded();
  // Ballot 4 was challenged by an official's batch (MISMATCH_DETECTED -> CHALLENGED, in seeded()).
  // Ballot 5 was challenged at ingest: a status-less MISMATCH_DETECTED flag, then STATUS_CHANGE -> CHALLENGED.
  const b5 = tables.ballot_public.find((b) => b.tracking_code === "CODE-0005") as ReturnType<typeof ballot>;
  tables.ballot_event_public.push(
    { ...event(b5, "CHALLENGED", "18097", "MISMATCH_DETECTED"), id: `e-${b5.id}-flag`, to_status: null },
    event(b5, "CHALLENGED"),
  );
  tables.stage_records.push(record("county", "18097", "CHALLENGED", 2));
  serveDb(tables);
  const response = await call("18097", "CHALLENGED");
  expect(response.status).toBe(200);
  const body = (await response.json()) as Row;
  expectVerifierShape(body);
  expect(body).toMatchObject({ scope: "county", scope_id: "18097", stage: "CHALLENGED", ballot_count: 2 });
  expect((body.ballots as Row[]).map((b) => b.tracking_code).sort()).toEqual(["CODE-0004", "CODE-0005"]);
});

test("AC1: a MISMATCH_DETECTED event never counts toward a batch stage's record", async () => {
  const tables = seeded();
  // A stray MISMATCH_DETECTED into TALLIED_PRECINCT would make precinct 2's list 3, not 2, if it counted.
  const extra = ballot(9, "18097-002");
  tables.ballot_public.push(extra);
  tables.ballot_event_public.push(event(extra, "TALLIED_PRECINCT", "18097", "MISMATCH_DETECTED"));
  serveDb(tables);
  const response = await call("18097-002", "TALLIED_PRECINCT");
  expect(response.status).toBe(200);
  expect(((await response.json()) as Row).ballot_count).toBe(2);
});

test("AC1: ballots are in ciphertext-hash order, never cast order, and a large record is read a page at a time", async () => {
  const count = PAGE_SIZE + 5;
  const ballots = Array.from({ length: count }, (_, i) => ballot(i + 1, "18097-001"));
  const tables = seeded();
  tables.ballot_public = ballots;
  tables.ballot_event_public = ballots.map((b) => event(b, "TALLIED_PRECINCT"));
  tables.stage_records = [record("precinct", "18097-001", "TALLIED_PRECINCT", count)];
  serveDb(tables);
  const body = (await (await call("18097-001", "TALLIED_PRECINCT")).json()) as Row;
  expectVerifierShape(body);
  const codes = (body.ballots as Row[]).map((b) => b.tracking_code);
  expect(codes).not.toEqual(ballots.map((b) => b.tracking_code));
  expect(db.calls.filter((c) => c.url.pathname.endsWith("ballot_public")).length).toBe(2);
});

test("AC1: a county with more precincts than one filter holds reads them in chunks", async () => {
  const tables = seeded();
  const extra = Array.from({ length: ID_CHUNK + 3 }, (_, i) => ({ id: `18097-x${i}`, county_id: "18097", name: "x" }));
  tables.precincts.push(...extra);
  const late = ballot(77, `18097-x${ID_CHUNK + 1}`);
  tables.ballot_public.push(late);
  tables.ballot_event_public.push(event(late, "REPORTED_UNOFFICIAL"));
  tables.stage_records = [record("county", "18097", "REPORTED_UNOFFICIAL", 4)];
  serveDb(tables);
  const response = await call("18097", "REPORTED_UNOFFICIAL");
  expect(response.status).toBe(200);
  const body = (await response.json()) as Row;
  expect((body.ballots as Row[]).map((b) => b.tracking_code)).toContain("CODE-0077");
});

test("AC1: totals keep a contest named __proto__ as data", () => {
  const totals = parseTotals(JSON.parse('{"__proto__": {"x": 1}, "governor": {"alice": 2}}'));
  expect(totals && Object.hasOwn(totals, "__proto__")).toBe(true);
  expect(JSON.parse(JSON.stringify(totals))).toEqual(JSON.parse('{"__proto__": {"x": 1}, "governor": {"alice": 2}}'));
  expect(parseTotals({ governor: { alice: "2" } })).toBeNull();
  expect(parseTotals([])).toBeNull();
});

test("AC1: a stored base64 signature is served as 128 hex; anything else is not a signature", () => {
  expect(signatureHex(SIG_BASE64)).toBe(SIG_HEX);
  expect(signatureHex(SIG_HEX)).toBe(SIG_HEX);
  expect(signatureHex(Buffer.from([1, 2, 3]).toString("base64"))).toBeNull();
  expect(signatureHex("not a signature!")).toBeNull();
  expect(signatureHex(null)).toBeNull();
});

// --- AC2: path parameters and 404s ---------------------------------------------------------------

test("AC2: a stage that is not published yet returns 404", async () => {
  // CERTIFIED exists with a future published_at (hidden by RLS); CHALLENGED has no row at all.
  for (const stage of ["CERTIFIED", "CHALLENGED", "DISCARDED"]) {
    const response = await call("18097", stage);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  }
});

test("AC2: a record whose published_at is in the future is not served even if a read returns it", async () => {
  const tables = seeded();
  const source = postgrestRecordSource(ENV, fakePostgrest(tables, { now: new Date("3000-01-01T00:00:00Z") }).fetch);
  expect(await source!.read("county", "18097", "CERTIFIED")).toBeNull();
});

test("AC2: an unknown scope returns 404", async () => {
  // "18097" is a county id, so it is not a precinct scope.
  for (const scope of ["99999", "18097-999", "18097"]) {
    const response = await call(scope, "TALLIED_PRECINCT");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  }
  expect((await call("18097-001", "REPORTED_UNOFFICIAL")).status).toBe(404); // a precinct id is not a county scope
});

test("AC2: an unknown stage or a malformed scope returns 404 without touching the database", async () => {
  const cases: Array<[string, string]> = [
    ["18097", "SPOILED"],
    ["18097", "CAST"],
    ["18097", "reported_unofficial"],
    ["18097", "__proto__"],
    ["18097", "toString"],
    ["18097", ""],
    ["../18097", "CERTIFIED"],
    ["18097,18001", "CERTIFIED"],
    ['18097"', "CERTIFIED"],
    ["", "CERTIFIED"],
    ["a".repeat(65), "CERTIFIED"],
  ];
  for (const [scope, stage] of cases) {
    const response = await call(scope, stage);
    expect(response.status, `${scope}/${stage}`).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  }
  expect(db.calls).toHaveLength(0);
});

test("AC2: every stage in the locked list is accepted", async () => {
  expect(Object.keys(RECORD_STAGES)).toEqual(["TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "CERTIFIED", "CHALLENGED", "DISCARDED"]);
});

// --- AC3: no auth, read-only, published public data only ----------------------------------------

test("AC3: needs no auth: a request with no cookies or headers is served", async () => {
  const response = await call("18097-001", "TALLIED_PRECINCT", { headers: {} });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

test("AC3: read-only: the route exports GET only and every database call is a GET with the publishable key", async () => {
  const exported = Object.keys(routeModule).filter((k) => /^[A-Z]+$/.test(k));
  expect(exported).toEqual(["GET"]);
  await call("18097", "REPORTED_UNOFFICIAL");
  expect(db.calls.length).toBeGreaterThan(0);
  for (const { url, init } of db.calls) {
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get("apikey")).toBe(ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    expect(JSON.stringify(init)).not.toContain("sb_secret");
    expect(url.pathname).toMatch(/^\/rest\/v1\/(stage_records|ballot_event_public|ballot_public|precincts)$/);
  }
});

test("AC3: reads only public columns: no ciphertext, event timestamps or private fields are requested", async () => {
  await call("18097", "REPORTED_UNOFFICIAL");
  const selected = db.calls.flatMap(({ url }) => url.searchParams.get("select")?.split(",") ?? []);
  for (const forbidden of ["ciphertext", "occurred_at", "recorded_at", "actor_id", "batch_id", "machine_id", "*"]) {
    expect(selected).not.toContain(forbidden);
  }
});

test("AC3: the body holds no voter identity, ids, times or sequence", async () => {
  const tables = seeded();
  // Even if a view returned more columns than asked for, none of them reaches the body.
  for (const b of tables.ballot_public) Object.assign(b, { ciphertext: "c2VjcmV0", name: "Jane Voter", occurred_at: "2026-11-03T08:01:02Z" });
  serveDb(tables);
  const text = await (await call("18097-001", "TALLIED_PRECINCT")).text();
  expect(text).not.toMatch(/T\d{2}:\d{2}/); // no time of day
  for (const forbidden of ["published_at", "occurred", "recorded", "ballot_id", '"id"', "ciphertext\"", "c2VjcmV0", "Jane", "name", "leaf", "index", "sequence", "cast_date", "phone", "birth"]) {
    expect(text).not.toContain(forbidden);
  }
});

// --- Failure modes ------------------------------------------------------------------------------

test("a database error returns a generic 503 that names nothing", async () => {
  for (const table of ["stage_records", "ballot_event_public", "ballot_public"]) {
    serveDb(seeded(), { failOn: table });
    const response = await call("18097-001", "TALLIED_PRECINCT");
    expect(response.status, table).toBe(503);
    expect(await response.json()).toEqual({ error: "record_unavailable" });
  }
});

test("a ballot list that disagrees with ballot_count is not served (503)", async () => {
  const tables = seeded();
  tables.stage_records[0] = record("precinct", "18097-001", "TALLIED_PRECINCT", 4);
  serveDb(tables);
  expect((await call("18097-001", "TALLIED_PRECINCT")).status).toBe(503);
});

test("two records for one scope and stage are not served (503), since their ballot lists can't be told apart", async () => {
  const tables = seeded();
  tables.stage_records.push({ ...record("precinct", "18097-001", "TALLIED_PRECINCT", 3), id: "r-second" });
  serveDb(tables);
  expect((await call("18097-001", "TALLIED_PRECINCT")).status).toBe(503);
});

test("a malformed stored record (root, signature or totals) is not served (503)", async () => {
  for (const bad of [{ merkle_root: "XYZ" }, { signature: null }, { totals: { governor: { alice: "two" } } }, { ballot_count: -1 }]) {
    const tables = seeded();
    Object.assign(tables.stage_records[0]!, bad);
    serveDb(tables);
    expect((await call("18097-001", "TALLIED_PRECINCT")).status, JSON.stringify(bad)).toBe(503);
  }
});

test("missing Supabase settings return 500 server_misconfigured", async () => {
  vi.unstubAllEnvs();
  const response = await call("18097-001", "TALLIED_PRECINCT");
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "server_misconfigured" });
});

test("a source that throws anything is a 503, never a 200 or a leaked message", async () => {
  const source: StageRecordSource = {
    read: async () => {
      throw new Error("relation private.ballots does not exist");
    },
  };
  const response = await handleRecordRequest("18097", "CERTIFIED", source);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private");
});
