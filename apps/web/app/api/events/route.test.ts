import { sha256Hex } from "@vbt/events";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MAX_UPLOAD_BYTES } from "../../../lib/ingest";
import { fileBytes, KEY_ENV, recordFile, sealedBallots } from "../../../lib/testing/election-fixtures";
import { aal2, accessToken, ENV, fakeSupabase, type FakeSupabaseOptions, SECRET_KEY, USERS } from "../../../lib/testing/fake-supabase";
import { POST } from "./route";

// POST /api/events with its real dependencies: requireRole, supabase-js and process.env, against the
// fake Supabase project (T-20 pattern), which plays the RPCs.

const ballots = await sealedBallots(3);
const valid = recordFile(ballots);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

function form(bytes: Uint8Array, name = "file"): FormData {
  const data = new FormData();
  data.set(name, new Blob([bytes as BlobPart], { type: "application/json" }), "record.json");
  return data;
}

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  POST(new Request("https://vbt.example/api/events", { method: "POST", body, headers }));

const OK_RPC: FakeSupabaseOptions["rpc"] = (name) => {
  if (name === "chain_heads") return Response.json([]);
  if (name === "ingest_ballot_record") return Response.json({ file_id: "f-1", event_ids: ["e-1", "e-2", "e-3"] });
  return Response.json({ message: "unexpected" }, { status: 404 });
};

let fake = fakeSupabase({ rpc: OK_RPC });
const ingestCalls = () => fake.rpcCalls.filter((c) => c.name === "ingest_ballot_record");

function useFake(options: FakeSupabaseOptions) {
  fake = fakeSupabase(options);
  vi.stubGlobal("fetch", fake.fetch);
}

beforeEach(() => {
  for (const [name, value] of Object.entries({ ...ENV, ...KEY_ENV, SUPABASE_SECRET_KEY: SECRET_KEY })) vi.stubEnv(name, value);
  useFake({ rpc: OK_RPC });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("AC5: a county official's valid file is 201 { file_id, event_ids }; the RPC gets the file's sha256 and count", async () => {
  const bytes = fileBytes(valid);
  const response = await post(form(bytes), bearer(await aal2(USERS.county)));
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ file_id: "f-1", event_ids: ["e-1", "e-2", "e-3"] });

  expect(fake.rpcCalls.map((c) => c.name)).toEqual(["chain_heads", "ingest_ballot_record"]);
  const file = ingestCalls()[0]!.args.p_file as { sha256: string; ballot_count: number; actor_id: string; ballots: unknown[] };
  expect(file.sha256).toBe(sha256Hex(bytes));
  expect(file.ballot_count).toBe(3);
  expect(file.actor_id).toBe(USERS.county);
  expect(file.ballots).toHaveLength(3);
  // Written with the service key only.
  const rpcRequests = fake.requests.filter((r) => r.url.pathname.startsWith("/rest/v1/rpc/"));
  expect(rpcRequests.every((r) => r.headers.get("apikey") === SECRET_KEY)).toBe(true);
});

test("a state official may upload for any county", async () => {
  const other = recordFile(await sealedBallots(1, { precinct: "18057-001" }), { county_id: "18057" });
  expect((await post(form(fileBytes(other)), bearer(await aal2(USERS.state)))).status).toBe(201);
});

test("AC5, C4: re-uploading the same file is 409", async () => {
  useFake({
    rpc: (name) =>
      name === "ingest_ballot_record"
        ? Response.json({ code: "VB409", message: "this file was already uploaded", details: null, hint: null }, { status: 400 })
        : Response.json([]),
  });
  const response = await post(form(fileBytes(valid)), bearer(await aal2(USERS.county)));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "conflict", message: "this file was already uploaded" });
});

test.each([
  ["a wrong tracking code", recordFile([{ ...ballots[0]!, tracking_code: "RIVER-MAPLE-7Q4K-HAWK" }]), "TRACKING_CODE_MISMATCH"],
  ["bad base64", recordFile([{ ...ballots[0]!, ciphertext: "%%%" }]), "INVALID_CIPHERTEXT"],
  ["an unknown precinct", recordFile([{ ...ballots[0]!, precinct_id: "99999-001" }]), "UNKNOWN_PRECINCT"],
  ["a precinct outside county_id", recordFile([{ ...ballots[0]!, precinct_id: "18057-001", machine_id: "M-18057-001-A" }]), "PRECINCT_NOT_IN_COUNTY"],
  ["a duplicate code in the file", recordFile([ballots[0]!, ballots[0]!]), "DUPLICATE_TRACKING_CODE"],
  ["a ciphertext that won't open", recordFile([{ ...ballots[0]!, ciphertext: Buffer.alloc(96, 7).toString("base64"), tracking_code: "X" }]), "TRACKING_CODE_MISMATCH"],
  ["an unknown format", { ...valid, format: "other" }, "INVALID_FORMAT"],
])("AC5: %s is 422 and nothing is written", async (_name, file, code) => {
  const response = await post(form(fileBytes(file)), bearer(await aal2(USERS.county)));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ code });
  expect(ingestCalls()).toEqual([]);
});

test("AC5: a correctly coded ciphertext that won't open is 422 CIPHERTEXT_INVALID", async () => {
  const { computeTrackingCode } = await import("@vbt/crypto");
  const junk = Buffer.alloc(600, 9);
  const file = recordFile([{ ...ballots[0]!, ciphertext: junk.toString("base64"), tracking_code: computeTrackingCode(junk, null) }]);
  const response = await post(form(fileBytes(file)), bearer(await aal2(USERS.county)));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ code: "CIPHERTEXT_INVALID" });
  expect(ingestCalls()).toEqual([]);
});

test("AC5: over 4.5 MB is 413, by content-length or by file size, before anything else", async () => {
  const declared = await post(form(fileBytes(valid)), { "content-length": String(MAX_UPLOAD_BYTES + 1) });
  expect(declared.status).toBe(413);
  const big = await post(form(new Uint8Array(MAX_UPLOAD_BYTES + 1)), bearer(await aal2(USERS.county)));
  expect(big.status).toBe(413);
  expect(fake.rpcCalls).toEqual([]);
});

test("a request that is not one multipart file, or a file that is not JSON, is 400", async () => {
  const token = bearer(await aal2(USERS.county));
  expect((await post(JSON.stringify(valid), { ...token, "content-type": "application/json" })).status).toBe(400);
  expect((await post(form(fileBytes(valid), "upload"), token)).status).toBe(400);
  expect((await post(form(new TextEncoder().encode("{nope")), token)).status).toBe(400);
});

test("AC7: no session, a single-factor session, a poll worker, or another county's official gets 403, nothing written", async () => {
  const other = recordFile(await sealedBallots(1, { precinct: "18057-001" }), { county_id: "18057" });
  for (const [headers, file] of [
    [{}, valid],
    [bearer(await accessToken({ sub: USERS.county, aal: "aal1" })), valid],
    [bearer(await aal2(USERS.pollWorker)), valid],
    [bearer(await aal2(USERS.noGrant)), valid],
    [bearer(await aal2(USERS.county)), other],
  ] as const) {
    const response = await post(form(fileBytes(file)), headers);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  }
  expect(fake.rpcCalls).toEqual([]);
});

test("C22: missing election keys is 500 server_misconfigured, after the auth check, with nothing written", async () => {
  vi.stubEnv("ELECTION_SECRET_KEY", "");
  const response = await post(form(fileBytes(valid)), bearer(await aal2(USERS.county)));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "server_misconfigured" });
  expect(fake.rpcCalls).toEqual([]);
  expect((await post(form(fileBytes(valid)))).status).toBe(403);
});
