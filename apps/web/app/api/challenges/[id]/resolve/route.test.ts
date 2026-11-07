import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fakeDb } from "../../../../../lib/testing/fake-db";
import { aal2, accessToken, ENV, fakeSupabase, LIVE_SESSION, USERS } from "../../../../../lib/testing/fake-supabase";
import { bearer } from "../../../../../lib/testing/requests";

// T-09 AC4 and AC2: POST /api/challenges/{ballot id}/resolve.
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../../../lib/official-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../lib/official-db")>()),
  serviceDb: () => state.db,
}));
const { POST } = await import("./route");

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

const resolve = (token: string | null, id: string, body: unknown) =>
  POST(
    new Request(`https://vbt.example/api/challenges/${id}/resolve`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", ...(token ? bearer(token) : {}) },
    }),
    { params: Promise.resolve({ id }) },
  );

/** A ballot of 18097-001 challenged from TALLIED_PRECINCT. */
function challenged() {
  const ballot = fake.ballots[0]!;
  ballot.status = "TALLIED_PRECINCT";
  fake.challenge(ballot.id);
  return ballot;
}

test("AC4: rejecting without a reason returns 400 and writes nothing", async () => {
  const ballot = challenged();
  const token = await aal2(USERS.county);
  for (const body of [{ decision: "rejected" }, { decision: "rejected", reason: "   " }, { decision: "rejected", reason: null }]) {
    const response = await resolve(token, ballot.id, body);
    expect(response.status).toBe(400);
  }
  expect(fake.writes()).toEqual([]);
  expect(ballot.status).toBe("CHALLENGED");
});

test("AC4: rejecting with a reason discards the ballot with one CHALLENGE_RESOLVED event carrying the reason", async () => {
  const ballot = challenged();
  const response = await resolve(await aal2(USERS.county), ballot.id, { decision: "rejected", reason: "  Not on the poll book " });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "DISCARDED" });
  expect(ballot.events.at(-1)).toEqual({ from: "CHALLENGED", to: "DISCARDED", type: "CHALLENGE_RESOLVED", reason: "Not on the poll book" });
  expect(fake.calls.find((c) => c.method === "resolveChallenge")!.args).toEqual([ballot.id, "DISCARDED", "Not on the poll book", "county", USERS.county]);
});

test("AC4: accepting returns the ballot to the status it held before the challenge", async () => {
  const ballot = challenged();
  const response = await resolve(await aal2(USERS.state), ballot.id, { decision: "accepted" });
  expect(await response.json()).toEqual({ status: "TALLIED_PRECINCT" });
  expect(ballot.status).toBe("TALLIED_PRECINCT");
});

test("AC4: a ballot that is not challenged returns 409; an unknown ballot 404; a bad body 400", async () => {
  const token = await aal2(USERS.county);
  expect((await resolve(token, fake.ballots[1]!.id, { decision: "accepted" })).status).toBe(409);
  expect((await resolve(token, "00000000-0000-4000-9000-0000000fffff", { decision: "accepted" })).status).toBe(404);
  expect((await resolve(token, "not-a-uuid", { decision: "accepted" })).status).toBe(404);
  const ballot = challenged();
  expect((await resolve(token, ballot.id, { decision: "maybe" })).status).toBe(400);
  expect((await resolve(token, ballot.id, { decision: "accepted", reason: 5 })).status).toBe(400);
  expect((await resolve(token, ballot.id, { decision: "rejected", reason: "x".repeat(501) })).status).toBe(400);
  expect((await resolve(token, ballot.id, "not json")).status).toBe(400);
  expect((await resolve(token, ballot.id, "null")).status).toBe(400);
  expect(fake.writes()).toEqual([]);
});

test("a database refusal under the row lock is passed on (409), never a 500", async () => {
  const ballot = challenged();
  const token = await aal2(USERS.county);
  fake.db.resolveChallenge = async () => {
    const { DbError } = await import("../../../../../lib/official-db");
    throw new DbError("ballot is not challenged", "VB409");
  };
  expect((await resolve(token, ballot.id, { decision: "accepted" })).status).toBe(409);
  fake.db.resolveChallenge = async () => {
    throw new Error("connection reset");
  };
  const failed = await resolve(token, ballot.id, { decision: "accepted" });
  expect(failed.status).toBe(500);
  expect(JSON.stringify(await failed.json())).not.toMatch(/connection/);
});

test("AC2: non-officials, poll workers and other counties get 403 and nothing is written", async () => {
  const ballot = challenged();
  const body = { decision: "rejected", reason: "x" };
  expect((await resolve(null, ballot.id, body)).status).toBe(403);
  expect((await resolve(await accessToken({ sub: USERS.county, aal: "aal1" }), ballot.id, body)).status).toBe(403);
  expect((await resolve(await aal2(USERS.noGrant), ballot.id, body)).status).toBe(403);
  expect((await resolve(await aal2(USERS.pollWorker), ballot.id, body)).status).toBe(403);
  const other = fake.ballots.find((b) => b.precinct_id === "18057-001")!;
  fake.challenge(other.id);
  const response = await resolve(await aal2(USERS.county), other.id, body);
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "forbidden" });
  vi.stubGlobal("fetch", fakeSupabase({ revokedSessions: [LIVE_SESSION] }).fetch);
  expect((await resolve(await aal2(USERS.county), ballot.id, body)).status).toBe(403);
  expect(fake.writes()).toEqual([]);
});
