import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { aal2, accessToken, ENV, fakeSupabase, USERS } from "../../../../lib/testing/fake-supabase";
import type { Queryable } from "../../../../lib/private-db";
import { GET } from "./route";

// The route with the real requireRole (fake Supabase project) and a fake private database that answers
// the report query the way Postgres would: it filters the flagged rows by the query's scope parameters.
// The database query itself is tested against Postgres in lib/mismatch-report.db.test.ts.

const FLAGGED = [
  { ballot_id: "b-3", tracking_code: "DELTA-EMBER-0003-FAKE", cast_date: "2026-11-03", current_status: "CHALLENGED", precinct_id: "18097-002", county_id: "18097", precinct_name: "Center 2" },
  { ballot_id: "b-1", tracking_code: "CEDAR-AMBER-0001-FAKE", cast_date: "2026-11-03", current_status: "CHALLENGED", precinct_id: "18097-001", county_id: "18097", precinct_name: "Center 1" },
  { ballot_id: "b-2", tracking_code: "AMBER-BIRCH-0002-FAKE", cast_date: "2026-11-03", current_status: "CHALLENGED", precinct_id: "18097-001", county_id: "18097", precinct_name: "Center 1" },
  { ballot_id: "b-4", tracking_code: "GROVE-FJORD-0004-FAKE", cast_date: "2026-11-03", current_status: "CHALLENGED", precinct_id: "18057-001", county_id: "18057", precinct_name: "Fall Creek 1" },
];

const db = vi.hoisted(() => ({ calls: [] as unknown[][], fail: false }));

vi.mock("../../../../lib/private-db", () => ({
  withServiceRoleReadOnly: async <T>(fn: (q: Queryable) => Promise<T>) => {
    if (db.fail) throw new Error("PRODUCT_DATABASE_URL is not set");
    return fn({
      query: async (_sql: string, params: unknown[] = []) => {
        db.calls.push(params);
        const [scope, id] = params;
        const rows = FLAGGED.filter(
          (r) => scope === "all" || (scope === "precinct" && r.precinct_id === id) || (scope === "county" && r.county_id === id),
        );
        return { rows };
      },
    });
  },
}));

const call = (query = "", headers: Record<string, string> = {}) =>
  GET(new Request(`https://vbt.example/api/reports/mismatches${query}`, { headers }));
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const precinctsOf = async (response: Response) =>
  ((await response.json()) as { precincts: Array<{ precinct_id: string }> }).precincts.map((p) => p.precinct_id);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV.NEXT_PUBLIC_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  vi.stubGlobal("fetch", fakeSupabase().fetch);
  db.calls = [];
  db.fail = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("AC4: no session, a garbage token, an aal1 session or no grant: 403, and the database is never read", async () => {
  for (const response of [
    await call(),
    await call("", bearer("x")),
    await call("", bearer(await accessToken({ sub: USERS.state, aal: "aal1" }))),
    await call("", bearer(await aal2(USERS.noGrant))),
  ]) {
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "forbidden" });
  }
  expect(db.calls).toEqual([]);
});

test("AC4: a malformed target, or one outside the official's scope, is 403", async () => {
  const state = await aal2(USERS.state);
  for (const query of ["?precinct=", "?precinct=18097-001&county=18097", "?county=1&county=2", `?precinct=${"x".repeat(65)}`]) {
    expect((await call(query, bearer(state))).status, query).toBe(403);
  }
  const county = await aal2(USERS.county);
  for (const query of ["?precinct=18057-001", "?county=18057", "?county=UNKNOWN"]) {
    expect((await call(query, bearer(county))).status, query).toBe(403);
  }
  const pollWorker = await aal2(USERS.pollWorker);
  for (const query of ["?precinct=18097-002", "?county=18097"]) {
    expect((await call(query, bearer(pollWorker))).status, query).toBe(403);
  }
  expect(db.calls).toEqual([]);
});

test.each([
  ["poll worker", USERS.pollWorker, ["precinct", "18097-001"], ["18097-001"]],
  ["county official", USERS.county, ["county", "18097"], ["18097-001", "18097-002"]],
  ["state official", USERS.state, ["all", null], ["18057-001", "18097-001", "18097-002"]],
])("AC4: an aal2 %s gets 200 with only their own scope by default", async (_name, user, params, precincts) => {
  const response = await call("", bearer(await aal2(user)));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(db.calls).toEqual([params]);
  expect(await precinctsOf(response)).toEqual(precincts);
});

test("AC4: a target inside the official's scope narrows the report", async () => {
  const county = await aal2(USERS.county);
  expect(await precinctsOf(await call("?precinct=18097-002", bearer(county)))).toEqual(["18097-002"]);
  const state = await aal2(USERS.state);
  expect(await precinctsOf(await call("?county=18057", bearer(state)))).toEqual(["18057-001"]);
  const pollWorker = await aal2(USERS.pollWorker);
  expect(await precinctsOf(await call("?precinct=18097-001", bearer(pollWorker)))).toEqual(["18097-001"]);
});

test("AC3/AC4: grouped by precinct, sorted by tracking code, every ballot challenged, with a total", async () => {
  const body = await (await call("", bearer(await aal2(USERS.state)))).json();
  expect(body).toEqual({
    total: 4,
    precincts: [
      { precinct_id: "18057-001", county_id: "18057", name: "Fall Creek 1", count: 1, ballots: [{ ballot_id: "b-4", tracking_code: "GROVE-FJORD-0004-FAKE", cast_date: "2026-11-03", current_status: "CHALLENGED" }] },
      {
        precinct_id: "18097-001",
        county_id: "18097",
        name: "Center 1",
        count: 2,
        ballots: [
          { ballot_id: "b-2", tracking_code: "AMBER-BIRCH-0002-FAKE", cast_date: "2026-11-03", current_status: "CHALLENGED" },
          { ballot_id: "b-1", tracking_code: "CEDAR-AMBER-0001-FAKE", cast_date: "2026-11-03", current_status: "CHALLENGED" },
        ],
      },
      { precinct_id: "18097-002", county_id: "18097", name: "Center 2", count: 1, ballots: [{ ballot_id: "b-3", tracking_code: "DELTA-EMBER-0003-FAKE", cast_date: "2026-11-03", current_status: "CHALLENGED" }] },
    ],
  });
});

test("AC8: the response holds no previous code, machine, time or ciphertext field", async () => {
  const text = await (await call("", bearer(await aal2(USERS.state)))).text();
  for (const forbiddenKey of ["prev_tracking_code", "machine_id", "occurred_at", "recorded_at", "ciphertext", "precinct_name"]) {
    expect(text).not.toContain(forbiddenKey);
  }
  expect(text).not.toMatch(/T\d{2}:\d{2}/);
});

test("an authorized official gets 503 with no detail when the database is unavailable", async () => {
  db.fail = true;
  const response = await call("", bearer(await aal2(USERS.state)));
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ error: "unavailable" });
});

test("an unauthorized caller gets 403, not 503, even when the database is unavailable", async () => {
  db.fail = true;
  expect((await call()).status).toBe(403);
});
