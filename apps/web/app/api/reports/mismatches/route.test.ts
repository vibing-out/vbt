import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fakeDb } from "../../../../lib/testing/fake-db";
import { aal2, accessToken, ENV, fakeSupabase, LIVE_SESSION, USERS } from "../../../../lib/testing/fake-supabase";
import { bearer } from "../../../../lib/testing/requests";

// T-09 AC5 and AC2: GET /api/reports/mismatches.
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../../lib/official-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/official-db")>()),
  serviceDb: () => state.db,
}));
const { GET } = await import("./route");

let fake: ReturnType<typeof fakeDb>;
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV.NEXT_PUBLIC_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  vi.stubGlobal("fetch", fakeSupabase().fetch);
  fake = fakeDb();
  state.db = fake.db;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const report = (token: string | null, query: string) =>
  GET(new Request(`https://vbt.example/api/reports/mismatches${query}`, { headers: token ? bearer(token) : {} }));

function mismatch(precinct: string) {
  const ballot = fake.ballots.find((b) => b.precinct_id === precinct && b.status === "CAST")!;
  fake.challenge(ballot.id, "Cross-check C1 failed");
  ballot.mismatch = true;
  return ballot;
}

test("AC5: lists only mismatched or challenged ballots in scope, with a date and no time", async () => {
  const inScope = mismatch("18097-002");
  mismatch("18057-001");
  const response = await report(await aal2(USERS.county), "?county=18097");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const { mismatches } = await response.json();
  expect(mismatches).toEqual([
    {
      ballot_id: inScope.id,
      tracking_code: inScope.tracking_code,
      precinct_id: "18097-002",
      machine_id: "M-18097-002-A",
      current_status: "CHALLENGED",
      reason: "Cross-check C1 failed",
      detected_on: "2026-11-03",
    },
  ]);
  for (const row of mismatches) {
    expect(row.detected_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(row)).not.toEqual(expect.arrayContaining(["occurred_at"]));
    expect(Object.keys(row).some((k) => /occurred_at|recorded_at|time/.test(k))).toBe(false);
    expect(JSON.stringify(row)).not.toMatch(/T\d{2}:\d{2}/);
  }
  expect((await (await report(await aal2(USERS.pollWorker), "?precinct=18097-001")).json()).mismatches).toEqual([]);
});

test("a timestamp from the database is cut to its date", async () => {
  mismatch("18097-001");
  const original = fake.db.mismatches;
  fake.db.mismatches = async (...args) => (await original(...args)).map((r) => ({ ...r, detected_on: "2026-11-03T23:59:59.123Z" }));
  const { mismatches } = await (await report(await aal2(USERS.county), "?county=18097")).json();
  expect(mismatches[0].detected_on).toBe("2026-11-03");
});

test("a missing target is 400; a database failure 500", async () => {
  expect((await report(await aal2(USERS.state), "")).status).toBe(400);
  fake.db.mismatches = async () => {
    throw new Error("boom");
  };
  expect((await report(await aal2(USERS.state), "?county=18097")).status).toBe(500);
});

test("AC2: 403 without an aal2 official in scope", async () => {
  expect((await report(null, "?county=18097")).status).toBe(403);
  expect((await report(await accessToken({ sub: USERS.county, aal: "aal1" }), "?county=18097")).status).toBe(403);
  expect((await report(await aal2(USERS.noGrant), "?county=18097")).status).toBe(403);
  expect((await report(await aal2(USERS.pollWorker), "?county=18097")).status).toBe(403);
  expect((await report(await aal2(USERS.pollWorker), "?precinct=18097-002")).status).toBe(403);
  expect((await report(await aal2(USERS.county), "?county=18057")).status).toBe(403);
  expect((await report(await aal2(USERS.county), "?county=18097&precinct=18097-001")).status).toBe(403);
  vi.stubGlobal("fetch", fakeSupabase({ revokedSessions: [LIVE_SESSION] }).fetch);
  expect((await report(await aal2(USERS.county), "?county=18097")).status).toBe(403);
  expect(fake.calls).toEqual([]);
});
