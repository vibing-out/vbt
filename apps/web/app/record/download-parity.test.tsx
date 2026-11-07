import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { groupByCounty } from "../../lib/record/group";
import { recordApiUrl } from "../../lib/record/links";
import { listPublishedRecords, readPublishedRecord } from "../../lib/record/read";
import { ENV, fakeTrackerDb, type TrackerDbData } from "../../lib/testing/fake-tracker-db";
import { GET } from "../api/record/[scope]/[stage]/route";
import { RecordListView } from "./record-list";

// AC4 without a live database: the /record list is built from listPublishedRecords on the fake
// PostgREST, and every download link it renders, fetched through the real route, returns exactly
// what readPublishedRecord builds for that scope and stage. Only the network is faked.

const hash = (n: number) => n.toString(16).padStart(64, "0");
const SIG = Buffer.alloc(64, 5);

const PRECINCTS = [
  { id: "18097-001", county_id: "18097", name: "Center 1" },
  { id: "18097-002", county_id: "18097", name: "Center 2" },
  { id: "18057-001", county_id: "18057", name: "Fall Creek 1" },
];
const BALLOTS_PER_PRECINCT: Record<string, number> = { "18097-001": 3, "18097-002": 2, "18057-001": 1 };

function data(): TrackerDbData {
  const ballots = PRECINCTS.flatMap((p, pi) =>
    Array.from({ length: BALLOTS_PER_PRECINCT[p.id]! }, (_, i) => ({
      id: `b-${p.id}-${i}`,
      tracking_code: `CODE-${p.id}-${i}`,
      ciphertext_hash: hash(900 - pi * 10 - i),
      precinct_id: p.id,
      cast_date: "2026-11-03",
      current_status: "REPORTED_UNOFFICIAL",
      ciphertext: "private",
    })),
  );
  let n = 0;
  const change = (b: (typeof ballots)[number], to: string) => ({
    id: `e-${b.id}-${to}`,
    ballot_id: b.id,
    precinct_id: b.precinct_id,
    county_id: PRECINCTS.find((p) => p.id === b.precinct_id)!.county_id,
    event_type: "STATUS_CHANGE",
    from_status: null,
    to_status: to,
    reason: null,
    occurred_on: "2026-11-03",
    prev_hash: null,
    hash: hash(n++),
    occurred_at: "2026-11-03T20:00:00Z",
  });
  const record = (scope: string, scopeId: string, stage: string, count: number, root: number) => ({
    id: `sr-${scopeId}-${stage}`,
    scope,
    scope_id: scopeId,
    stage,
    merkle_root: hash(root),
    ballot_count: count,
    totals: { mayor: { a: count, b: 0 } },
    published_at: "2026-11-04T03:30:00Z",
    signature: SIG.toString("base64"),
  });
  return {
    ballots,
    events: [...ballots.map((b) => change(b, "TALLIED_PRECINCT")), ...ballots.map((b) => change(b, "REPORTED_UNOFFICIAL"))],
    precincts: PRECINCTS,
    stageRecords: [
      record("precinct", "18097-001", "TALLIED_PRECINCT", 3, 1),
      record("precinct", "18097-002", "TALLIED_PRECINCT", 2, 2),
      record("precinct", "18057-001", "TALLIED_PRECINCT", 1, 3),
      record("county", "18097", "REPORTED_UNOFFICIAL", 5, 4),
      record("county", "18057", "REPORTED_UNOFFICIAL", 1, 5),
    ],
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV.NEXT_PUBLIC_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  vi.stubGlobal("fetch", fakeTrackerDb(data()).fetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("AC4: every download on /record returns exactly readPublishedRecord's record for its scope and stage", async () => {
  const deps = { env: ENV, fetch: fakeTrackerDb(data()).fetch };
  const listing = await listPublishedRecords(deps);
  expect(listing).toHaveLength(5);

  const html = renderToStaticMarkup(<RecordListView state={{ kind: "ready", counties: groupByCounty(listing!) }} />);
  const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*data-testid="record-download"/g)].map((m) => m[1]!);
  // One download per listed record, and each is that record's API URL.
  expect(hrefs.toSorted()).toEqual(listing!.map(({ record }) => recordApiUrl(record.scope_id, record.stage)).toSorted());

  for (const { record } of listing!) {
    const href = recordApiUrl(record.scope_id, record.stage);
    const [scope, stage] = href.split("/").slice(3).map(decodeURIComponent);
    const response = await GET(new Request(`https://vbt.example${href}`), {
      params: Promise.resolve({ scope: scope!, stage: stage! }),
    });
    expect(response.status, href).toBe(200);
    const body = await response.text();

    const expected = await readPublishedRecord(record.scope_id, record.stage, deps);
    expect(expected, href).not.toBeNull();
    expect(body, href).toBe(JSON.stringify(expected));
    // The download is the record the page lists: same root, count and signature, with its full ballot list.
    const { ballots, ...summary } = JSON.parse(body);
    expect(summary, href).toEqual(record);
    expect(ballots, href).toHaveLength(record.ballot_count);
  }
});
