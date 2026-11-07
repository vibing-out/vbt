import { verifyStageRecord } from "@vbt/crypto";
import { sha256Hex } from "@vbt/events";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { stageTree } from "../../../lib/batches";
import { KEY_ENV, membersOf, sealedBallots, SIGNING_PUBLIC_KEY } from "../../../lib/testing/election-fixtures";
import { aal2, accessToken, ENV, fakeSupabase, type FakeSupabaseOptions, SECRET_KEY, USERS } from "../../../lib/testing/fake-supabase";
import { POST } from "./route";

// POST /api/batches with its real dependencies (requireRole, supabase-js, process.env) against the
// fake Supabase project, which plays batch_members and apply_batch.

const members = membersOf(await sealedBallots(8), (code) => sha256Hex(code));
const bearer = (token: string) => ({ Authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://vbt.example/api/batches", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers,
    }),
  );

const precinctClose = { scope: "precinct", scope_id: "18097-001", from_status: "CAST", to_status: "TALLIED_PRECINCT" };

function rpcWith(list: unknown[], apply?: () => Response): FakeSupabaseOptions["rpc"] {
  return (name, args) => {
    if (name === "batch_members") return Response.json(list);
    if (name === "apply_batch") {
      const batch = args.p_batch as { batch_id: string; events: unknown[] };
      return apply ? apply() : Response.json({ batch_id: batch.batch_id, stage_record_id: batch.batch_id, ballot_count: batch.events.length });
    }
    return Response.json({ message: "unexpected" }, { status: 404 });
  };
}

let fake = fakeSupabase();
function useFake(options: FakeSupabaseOptions) {
  fake = fakeSupabase(options);
  vi.stubGlobal("fetch", fake.fetch);
}

beforeEach(() => {
  for (const [name, value] of Object.entries({ ...ENV, ...KEY_ENV, SUPABASE_SECRET_KEY: SECRET_KEY })) vi.stubEnv(name, value);
  useFake({ rpc: rpcWith(members) });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("AC1: a poll worker closing their precinct gets 201 with the batch, count and a signed stage record", async () => {
  const response = await post(precinctClose, bearer(await aal2(USERS.pollWorker)));
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body).toEqual({
    batch_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    ballot_count: 8,
    stage_record: { id: body.batch_id, merkle_root: stageTree(members).root, signature: expect.any(String) },
  });
  expect(fake.rpcCalls.map((c) => c.name)).toEqual(["batch_members", "apply_batch"]);
  expect(fake.rpcCalls[0]!.args).toEqual({ p_scope: "precinct", p_scope_id: "18097-001", p_from_status: "CAST" });

  const sent = fake.rpcCalls[1]!.args.p_batch as {
    batch_id: string;
    actor_role: string;
    actor_id: string;
    stage_record: { merkle_root: string; ballot_count: number; totals: Record<string, Record<string, number>>; signature: string };
  };
  expect([sent.batch_id, sent.actor_role, sent.actor_id]).toEqual([body.batch_id, "poll_worker", USERS.pollWorker]);
  const record = {
    scope: "precinct",
    stage: "TALLIED_PRECINCT",
    merkleRoot: sent.stage_record.merkle_root,
    ballotCount: sent.stage_record.ballot_count,
    totals: sent.stage_record.totals,
  };
  expect(await verifyStageRecord(record, Buffer.from(body.stage_record.signature, "base64"), SIGNING_PUBLIC_KEY)).toBe(true);
});

test.each([
  ["CAST -> CERTIFIED", { scope: "county", scope_id: "18097", from_status: "CAST", to_status: "CERTIFIED" }, "NOT_BATCH_TRANSITION"],
  ["CAST -> CHALLENGED", { scope: "county", scope_id: "18097", from_status: "CAST", to_status: "CHALLENGED" }, "NOT_BATCH_TRANSITION"],
  ["LOST -> CAST", { scope: "county", scope_id: "18097", from_status: "LOST", to_status: "CAST" }, "INVALID_STATUS"],
  ["precinct scope on TALLIED -> REPORTED", { scope: "precinct", scope_id: "18097-001", from_status: "TALLIED_PRECINCT", to_status: "REPORTED_UNOFFICIAL" }, "INVALID_BATCH_SCOPE"],
])("AC4: an aal2 county official asking for %s gets 422 with the domain code and no RPC", async (_name, body, code) => {
  const response = await post(body, bearer(await aal2(USERS.county)));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ code });
  expect(fake.rpcCalls).toEqual([]);
});

test("C15: an empty batch is 422 NO_BALLOTS and nothing is published", async () => {
  useFake({ rpc: rpcWith([]) });
  const response = await post(precinctClose, bearer(await aal2(USERS.county)));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ code: "NO_BALLOTS" });
  expect(fake.rpcCalls.map((c) => c.name)).toEqual(["batch_members"]);
});

test("AC4, C11: apply_batch raising is 409", async () => {
  useFake({
    rpc: rpcWith(members, () =>
      Response.json({ code: "VB409", message: "a ballot's chain head changed since it was read", details: null, hint: null }, { status: 400 }),
    ),
  });
  const response = await post(precinctClose, bearer(await aal2(USERS.county)));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "conflict", message: "a ballot's chain head changed since it was read" });
});

test("C14: malformed JSON or a body of the wrong shape is 400", async () => {
  const token = bearer(await aal2(USERS.county));
  expect((await post("{not json", token)).status).toBe(400);
  expect((await post({ ...precinctClose, scope: "state" }, token)).status).toBe(400);
  expect((await post({ scope: "precinct" }, token)).status).toBe(400);
  expect(fake.rpcCalls).toEqual([]);
});

test("AC7: no session, single-factor, or a scope the official does not cover gets 403 and nothing runs", async () => {
  const cases: Array<[Record<string, string>, unknown]> = [
    [{}, precinctClose],
    [bearer(await accessToken({ sub: USERS.county, aal: "aal1" })), precinctClose],
    [bearer(await aal2(USERS.noGrant)), precinctClose],
    [bearer(await aal2(USERS.pollWorker)), { ...precinctClose, scope_id: "18097-002" }],
    [bearer(await aal2(USERS.pollWorker)), { scope: "county", scope_id: "18097", from_status: "TALLIED_PRECINCT", to_status: "REPORTED_UNOFFICIAL" }],
    [bearer(await aal2(USERS.county)), { ...precinctClose, scope_id: "18057-001" }],
    [bearer(await aal2(USERS.county)), { scope: "county", scope_id: "18057", from_status: "TALLIED_PRECINCT", to_status: "REPORTED_UNOFFICIAL" }],
  ];
  for (const [headers, body] of cases) {
    const response = await post(body, headers);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  }
  expect(fake.rpcCalls).toEqual([]);
});

test("a body over the limit is 413", async () => {
  expect((await post(precinctClose, { "content-length": "100000" })).status).toBe(413);
});

test("C22: no service key is 500 server_misconfigured with nothing read", async () => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
  const response = await post(precinctClose, bearer(await aal2(USERS.state)));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "server_misconfigured" });
  expect(fake.rpcCalls).toEqual([]);
});
