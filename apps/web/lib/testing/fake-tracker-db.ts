// Test-only: a fake PostgREST for the tracker's four public reads (ballot_public, ballot_event_public,
// precincts, stage_records). It answers only the columns each view or table grants the public, so a
// select of a private column (occurred_at, ciphertext, batch_id, ...) fails as it would for real, and
// it applies the eq./in. filters the tracker uses. Every requested URL is recorded. Never imported by
// app code.

export const SUPABASE_URL = "https://tracker.supabase.co";
export const PUBLISHABLE_KEY = "sb_publishable_tracker_test";
export const ENV = { NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY };

type Row = Record<string, unknown>;

// Public columns, per supabase/migrations (core_schema grants + public_surface_fixes views).
const PUBLIC_COLUMNS: Record<string, readonly string[]> = {
  ballot_public: ["id", "tracking_code", "ciphertext_hash", "precinct_id", "cast_date", "current_status"],
  ballot_event_public: [
    "id", "ballot_id", "precinct_id", "county_id", "event_type", "from_status", "to_status", "reason",
    "occurred_on", "prev_hash", "hash",
  ],
  precincts: ["id", "county_id", "name"],
  stage_records: ["id", "scope", "scope_id", "stage", "merkle_root", "ballot_count", "totals", "published_at", "signature"],
};

export interface TrackerDbData {
  ballots: Row[];
  events: Row[];
  precincts: Row[];
  stageRecords: Row[];
}

export const BALLOT_ID = "6f0c7a52-1d1e-4b8a-9a43-0d9c1f3e2a11";
export const CIPHERTEXT_HASH = "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12";

/** A seeded-style ballot (supabase/seed.sql SEED-0001) counted at its precinct. */
export function seededData(): TrackerDbData {
  return {
    ballots: [
      {
        id: BALLOT_ID,
        tracking_code: "SEED-0001",
        ciphertext_hash: CIPHERTEXT_HASH,
        precinct_id: "18097-001",
        cast_date: "2026-11-03",
        current_status: "TALLIED_PRECINCT",
        // Private columns the public may not read; the fake must never return them.
        ciphertext: "seed-ciphertext-1",
        machine_id: "M-18097-001-A",
      },
    ],
    // Listed in hash order, as the view returns them, not chain order.
    events: [
      event({ hash: "f2", prev_hash: "a1", event_type: "STATUS_CHANGE", from_status: "CAST", to_status: "TALLIED_PRECINCT" }),
      event({ hash: "a1", prev_hash: null, event_type: "CAST", from_status: null, to_status: null }),
    ],
    precincts: [
      { id: "18097-001", county_id: "18097", name: "Center 1" },
      { id: "18097-002", county_id: "18097", name: "Center 2" },
      { id: "18057-001", county_id: "18057", name: "Fall Creek 1" },
    ],
    stageRecords: [
      stageRecord({ stage: "TALLIED_PRECINCT", scope: "precinct", scope_id: "18097-001" }),
      // Other precincts' and counties' records must not attach to this ballot.
      stageRecord({ stage: "TALLIED_PRECINCT", scope: "precinct", scope_id: "18097-002", merkle_root: "other" }),
      stageRecord({ stage: "REPORTED_UNOFFICIAL", scope: "county", scope_id: "18057", merkle_root: "other-county" }),
    ],
  };
}

export function event(fields: Row): Row {
  return {
    id: `evt-${String(fields.hash)}`,
    ballot_id: BALLOT_ID,
    precinct_id: "18097-001",
    county_id: "18097",
    reason: null,
    occurred_on: "2026-11-03",
    // Private: never returned.
    occurred_at: "2026-11-03T12:34:56Z",
    recorded_at: "2026-11-03T12:35:00Z",
    actor_id: "M-18097-001-A",
    batch_id: null,
    ...fields,
  };
}

export function stageRecord(fields: Row): Row {
  return {
    id: `sr-${String(fields.stage)}-${String(fields.scope_id)}`,
    merkle_root: `root-${String(fields.stage)}`,
    ballot_count: 17,
    totals: { mayor: { a: 9, b: 8 } },
    // 03:30 UTC on Nov 4 is still Nov 3 in Indiana.
    published_at: "2026-11-04T03:30:00Z",
    signature: "sig-base64",
    ...fields,
  };
}

const TABLES: Record<string, keyof TrackerDbData> = {
  ballot_public: "ballots",
  ballot_event_public: "events",
  precincts: "precincts",
  stage_records: "stageRecords",
};

function parseInList(value: string): string[] {
  const inner = value.slice(1, -1);
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|([^,]+)/g;
  for (const m of inner.matchAll(re)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2]!);
  return out;
}

export interface FakeTrackerDb {
  fetch: typeof fetch;
  requests: string[];
  data: TrackerDbData;
}

export function fakeTrackerDb(data: TrackerDbData = seededData(), options: { failOn?: string } = {}): FakeTrackerDb {
  const requests: string[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requests.push(url.pathname + url.search);
    const headers = new Headers(init?.headers);
    if (headers.get("apikey") !== PUBLISHABLE_KEY) return json({ message: "no key" }, 401);
    if (!url.href.startsWith(`${SUPABASE_URL}/rest/v1/`)) return json({ message: "not found" }, 404);
    const name = url.pathname.slice("/rest/v1/".length);
    if (options.failOn && name === options.failOn) return json({ message: "boom" }, 500);
    const table = TABLES[name];
    const columns = PUBLIC_COLUMNS[name];
    if (!table || !columns) return json({ message: `relation ${name} not in the Data API` }, 404);

    const select = (url.searchParams.get("select") ?? "*").split(",");
    const chosen = select[0] === "*" ? columns : select;
    if (chosen.some((c) => !columns.includes(c))) return json({ message: "permission denied for column" }, 401);

    let rows = data[table];
    for (const [param, value] of url.searchParams) {
      if (param === "select" || param === "limit") continue;
      if (value.startsWith("eq.")) rows = rows.filter((r) => String(r[param]) === value.slice(3));
      else if (value.startsWith("in.(") && value.endsWith(")")) {
        const allowed = parseInList(value.slice(3));
        rows = rows.filter((r) => allowed.includes(String(r[param])));
      } else return json({ message: `unsupported filter ${param}=${value}` }, 400);
    }
    const limit = url.searchParams.get("limit");
    if (limit) rows = rows.slice(0, Number(limit));
    return json(rows.map((r) => Object.fromEntries(chosen.map((c) => [c, r[c] ?? null]))));
  }) as typeof fetch;

  return { fetch: fakeFetch, requests, data };
}
