import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CRYPTO_UNAVAILABLE, hexToBytes } from "../../../lib/crypto";
import type { CryptoPort } from "../../../lib/crypto/port";
import { fakeCrypto, fakeRoot, FAKE_KEYS } from "../../../lib/testing/fake-crypto";
import { fakeDb, fixtureChoices } from "../../../lib/testing/fake-db";
import { aal2, accessToken, ENV, fakeSupabase, LIVE_SESSION, USERS } from "../../../lib/testing/fake-supabase";
import { bearer, fixture, fixtureJson, jsonBytes, multipart } from "../../../lib/testing/requests";

// T-09 AC1, AC1b–d, AC2, AC3: POST /api/batches with real requireRole (fake Supabase Auth), and the
// service database and crypto adapter replaced through their modules.
const state = vi.hoisted(() => ({ db: undefined as unknown, crypto: undefined as unknown }));
vi.mock("../../../lib/service-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/service-db")>()),
  serviceDb: () => state.db,
}));
vi.mock("../../../lib/crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/crypto")>();
  return { ...actual, getCrypto: () => state.crypto ?? actual.getCrypto(), keys: () => FAKE_KEYS };
});

const { POST } = await import("./route");

let fake: ReturnType<typeof fakeDb>;
let crypto: ReturnType<typeof fakeCrypto>;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV.NEXT_PUBLIC_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  vi.stubGlobal("fetch", fakeSupabase().fetch);
  fake = fakeDb();
  crypto = fakeCrypto();
  state.db = fake.db;
  state.crypto = crypto;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const URL_BASE = "https://vbt.example/api/batches";
const LOG = fixture("cdf-M-18097-001-A.json");
const PRECINCT_TOTALS = fixture("totals-precinct-18097-001.json");

async function tally(token: string, options: { query?: string; count?: number; files?: Array<[string, Uint8Array]> } = {}) {
  const request = multipart(
    `${URL_BASE}${options.query ?? "?precinct=18097-001"}`,
    { to_status: "TALLIED_PRECINCT", expected_count: String(options.count ?? 17) },
    options.files ?? [
      ["machine_log", LOG],
      ["precinct_totals", PRECINCT_TOTALS],
    ],
    bearer(token),
  );
  return POST(request);
}

function countyBatch(token: string, to: string, file: [string, Uint8Array], count: number, county = "18097") {
  return POST(multipart(`${URL_BASE}?county=${county}`, { to_status: to, expected_count: String(count) }, [file], bearer(token)));
}

/** County totals file for the fake ballots, as the simulator writes them, with an optional edit. */
function countyTotals(kind: "county_totals" | "certified_totals", edit: (t: Record<string, unknown>) => void = () => {}): [string, Uint8Array] {
  const file = fixtureJson(kind === "county_totals" ? "totals-county-18097.json" : "totals-certified-18097.json");
  edit(file);
  return [kind, jsonBytes(file)];
}

describe("AC1: a poll worker tallies a whole precinct in one action", () => {
  test("one request moves all 17 ballots, with one database write and a verified stage record", async () => {
    const response = await tally(await aal2(USERS.pollWorker));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ batch_id: expect.any(String), count: 17, challenged: 0, stage_record_id: expect.any(String) });

    const runs = fake.calls.filter((c) => c.method === "runBatch");
    expect(runs).toHaveLength(1);
    const args = runs[0]!.args[0] as { advance: string[]; challenge: unknown[]; actorRole: string; actorId: string; stageRecord: { merkle_root: string; signature: string; ballot_count: number; totals: unknown } };
    expect(args.advance).toHaveLength(17);
    expect(args.challenge).toEqual([]);
    expect(args).toMatchObject({ actorRole: "poll_worker", actorId: USERS.pollWorker, from: "CAST", to: "TALLIED_PRECINCT" });

    const leaves = fake.ballots.filter((b) => b.precinct_id === "18097-001").map((b) => hexToBytes(b.ciphertext_hash));
    expect(args.stageRecord.merkle_root).toBe(Buffer.from(fakeRoot(leaves)).toString("hex"));
    expect(args.stageRecord.ballot_count).toBe(17);
    expect(JSON.parse(JSON.stringify(args.stageRecord.totals))).toEqual({
      "contest-president": { "cand-a": 6, "cand-b": 6, "cand-c": 5 },
      "contest-measure-1": { yes: 9, no: 8 },
    });
    expect(crypto.calls).toEqual(["ready", "aggregateDecrypt", "buildMerkleTree", "signStageRecord", "verifyStageRecord"]);

    expect(fake.ballots.filter((b) => b.precinct_id === "18097-001").every((b) => b.status === "TALLIED_PRECINCT")).toBe(true);
    expect(fake.ballots.filter((b) => b.precinct_id !== "18097-001").every((b) => b.status === "CAST")).toBe(true);
    expect(fake.stageRecords).toHaveLength(1);
    expect(fake.uploads.map((u) => u.kind)).toEqual(["machine_log", "precinct_totals"]);
    expect(fake.uploads.every((u) => /^[0-9a-f]{64}$/.test(u.file_sha256) && u.uploaded_by === USERS.pollWorker)).toBe(true);
  });

  test("AC1b: with the production adapter it answers 503 'stage records publish once E3 lands' and touches nothing", async () => {
    state.crypto = undefined;
    const response = await tally(await aal2(USERS.pollWorker));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: CRYPTO_UNAVAILABLE });
    expect(fake.calls).toEqual([]);
    expect(fake.ballots.every((b) => b.status === "CAST")).toBe(true);
  });

  test("a stage record that does not verify is never written", async () => {
    state.crypto = { ...crypto, verifyStageRecord: async () => false } satisfies CryptoPort;
    const response = await tally(await aal2(USERS.pollWorker));
    expect(response.status).toBe(500);
    expect(fake.writes()).toEqual([]);
  });
});

describe("AC1c: cross-check failures challenge the affected ballots", () => {
  test("C1: a short machine log challenges that machine's ballots, and publishes no record for them", async () => {
    const response = await tally(await aal2(USERS.pollWorker), {
      files: [
        ["machine_log", fixture("cdf-M-18097-001-A-short.json")],
        ["precinct_totals", PRECINCT_TOTALS],
      ],
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ count: 0, challenged: 17, stage_record_id: null });
    const args = fake.calls.find((c) => c.method === "runBatch")!.args[0] as { challenge: Array<{ check: string }>; stageRecord: unknown };
    expect(new Set(args.challenge.map((c) => c.check))).toEqual(new Set(["C1"]));
    expect(args.stageRecord).toBeNull();
    const affected = fake.ballots.filter((b) => b.precinct_id === "18097-001");
    expect(affected.every((b) => b.status === "CHALLENGED" && b.mismatch)).toBe(true);
    expect(affected.every((b) => /^Cross-check C[1-4] failed$/.test(b.events.at(-1)!.reason ?? ""))).toBe(true);
    expect(fake.ballots.filter((b) => b.precinct_id !== "18097-001").every((b) => b.status === "CAST")).toBe(true);
  });

  test("C2: precinct totals that disagree with the decrypted tally challenge the whole precinct", async () => {
    const totals = fixtureJson<{ contests: Array<{ selections: Array<{ votes: number }> }> }>("totals-precinct-18097-001.json");
    totals.contests[0]!.selections[0]!.votes += 1;
    const response = await tally(await aal2(USERS.pollWorker), { files: [["machine_log", LOG], ["precinct_totals", jsonBytes(totals)]] });
    expect(await response.json()).toMatchObject({ count: 0, challenged: 17 });
    expect(fake.ballots.filter((b) => b.precinct_id === "18097-001").every((b) => b.events.at(-1)!.reason === "Cross-check C2 failed")).toBe(true);
  });
});

describe("AC1d: confirmation and inputs", () => {
  test("a stale expected_count returns 409 with the current count and writes nothing", async () => {
    const response = await tally(await aal2(USERS.pollWorker), { count: 16 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ count: 17 });
    expect(fake.writes()).toEqual([]);
  });

  test("a change between preview and the write returns 409", async () => {
    const preview = fake.db.batchBallots;
    fake.db.batchBallots = async (...args) => {
      const rows = await preview(...args);
      fake.challenge(rows[0]!.id);
      return rows;
    };
    const response = await tally(await aal2(USERS.pollWorker));
    expect(response.status).toBe(409);
    expect(fake.stageRecords).toEqual([]);
  });

  test.each([
    ["no machine log", [["precinct_totals", PRECINCT_TOTALS]]],
    ["no precinct totals", [["machine_log", LOG]]],
  ] as Array<[string, Array<[string, Uint8Array]>]>)("%s returns 422 and writes nothing", async (_name, files) => {
    const response = await tally(await aal2(USERS.pollWorker), { files });
    expect(response.status).toBe(422);
    expect(fake.writes()).toEqual([]);
  });

  test.each([
    ["a status no batch reaches", { to_status: "CHALLENGED", expected_count: "17" }, "?precinct=18097-001"],
    ["a county stage for a precinct", { to_status: "REPORTED_UNOFFICIAL", expected_count: "17" }, "?precinct=18097-001"],
    ["a missing count", { to_status: "TALLIED_PRECINCT" }, "?precinct=18097-001"],
  ])("%s returns 400", async (_name, fields, query) => {
    const request = multipart(`${URL_BASE}${query}`, fields as Record<string, string>, [["machine_log", LOG], ["precinct_totals", PRECINCT_TOTALS]], bearer(await aal2(USERS.county)));
    expect((await POST(request)).status).toBe(400);
    expect(fake.writes()).toEqual([]);
  });

  test("a device from another precinct, an unused file kind, or a non-multipart body returns 400", async () => {
    const token = await aal2(USERS.pollWorker);
    const otherDevice = fixtureJson<{ ElectionEventLog: { Device: Array<{ Id: string }> } }>("cdf-M-18097-001-A.json");
    otherDevice.ElectionEventLog.Device[0]!.Id = "M-18097-002-A";
    for (const files of [
      [["machine_log", jsonBytes(otherDevice)], ["precinct_totals", PRECINCT_TOTALS]],
      [["machine_log", LOG], ["precinct_totals", PRECINCT_TOTALS], ["county_totals", PRECINCT_TOTALS]],
      [["machine_log", LOG], ["precinct_totals", PRECINCT_TOTALS], ["precinct_totals", PRECINCT_TOTALS]],
      [["machine_log", new TextEncoder().encode("not json")], ["precinct_totals", PRECINCT_TOTALS]],
    ] as Array<Array<[string, Uint8Array]>>) {
      expect((await tally(token, { files })).status).toBe(400);
    }
    const json = new Request(`${URL_BASE}?precinct=18097-001`, { method: "POST", body: "{}", headers: { ...bearer(token), "content-type": "application/json" } });
    expect((await POST(json)).status).toBe(400);
    expect(fake.writes()).toEqual([]);
  });
});

describe("AC2: non-officials and out-of-scope officials get 403", () => {
  test("no session, a single-factor session, a revoked session or no grant", async () => {
    const tokens = [await accessToken({ sub: USERS.pollWorker, aal: "aal1" }), await aal2(USERS.noGrant)];
    for (const headers of [{}, ...tokens.map(bearer)]) {
      const response = await POST(multipart(`${URL_BASE}?precinct=18097-001`, { to_status: "TALLIED_PRECINCT", expected_count: "17" }, [], headers));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    vi.stubGlobal("fetch", fakeSupabase({ revokedSessions: [LIVE_SESSION] }).fetch);
    expect((await tally(await aal2(USERS.pollWorker))).status).toBe(403);
    expect(fake.calls).toEqual([]);
  });

  test("a poll worker on another precinct or on a county batch; a county official on another county; no target", async () => {
    const pw = await aal2(USERS.pollWorker);
    expect((await tally(pw, { query: "?precinct=18097-002" })).status).toBe(403);
    expect((await countyBatch(pw, "REPORTED_UNOFFICIAL", countyTotals("county_totals"), 0)).status).toBe(403);
    const county = await aal2(USERS.county);
    expect((await tally(county, { query: "?precinct=18057-001" })).status).toBe(403);
    expect((await countyBatch(county, "REPORTED_UNOFFICIAL", countyTotals("county_totals"), 0, "18057")).status).toBe(403);
    expect((await tally(county, { query: "" })).status).toBe(403);
    expect(fake.calls).toEqual([]);
  });
});

describe("AC3: county election-night report and certification", () => {
  async function tallyCounty() {
    const county = await aal2(USERS.county);
    expect((await tally(county)).status).toBe(201);
    const second = fixtureJson<Record<string, unknown>>("totals-precinct-18097-001.json");
    second.scopeId = "18097-002";
    const log = fixtureJson<{ ElectionEventLog: { Device: Array<{ Id: string }> } }>("cdf-M-18097-001-A.json");
    log.ElectionEventLog.Device[0]!.Id = "M-18097-002-A";
    const response = await tally(county, { query: "?precinct=18097-002", files: [["machine_log", jsonBytes(log)], ["precinct_totals", jsonBytes(second)]] });
    expect(response.status).toBe(201);
    return county;
  }

  test("C3 then C4 pass: each advances all 34 ballots with one stage record", async () => {
    const county = await tallyCounty();
    const night = await countyBatch(county, "REPORTED_UNOFFICIAL", countyTotals("county_totals"), 34);
    expect(night.status).toBe(201);
    expect(await night.json()).toMatchObject({ count: 34, challenged: 0 });
    const certify = await countyBatch(county, "CERTIFIED", countyTotals("certified_totals"), 34);
    expect(certify.status).toBe(201);
    expect(await certify.json()).toMatchObject({ count: 34, challenged: 0 });
    expect(fake.stageRecords.map((r) => [r.scope, r.scope_id, r.stage, r.ballot_count])).toEqual([
      ["precinct", "18097-001", "TALLIED_PRECINCT", 17],
      ["precinct", "18097-002", "TALLIED_PRECINCT", 17],
      ["county", "18097", "REPORTED_UNOFFICIAL", 34],
      ["county", "18097", "CERTIFIED", 34],
    ]);
    expect(fake.ballots.filter((b) => b.precinct_id.startsWith("18097")).every((b) => b.status === "CERTIFIED")).toBe(true);
    expect(fake.ballots.find((b) => b.precinct_id === "18097-002")!.events.map((e) => e.to)).toEqual([null, "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "CERTIFIED"]);
  });

  test("the state official may run them too; a poll worker may not", async () => {
    await tallyCounty();
    expect((await countyBatch(await aal2(USERS.pollWorker), "REPORTED_UNOFFICIAL", countyTotals("county_totals"), 34)).status).toBe(403);
    expect((await countyBatch(await aal2(USERS.state), "REPORTED_UNOFFICIAL", countyTotals("county_totals"), 34)).status).toBe(201);
  });

  test("C3: county totals that are not the sum of the precinct records challenge the county batch", async () => {
    const county = await tallyCounty();
    const response = await countyBatch(county, "REPORTED_UNOFFICIAL", countyTotals("county_totals", (t) => (t.ballotCount = 35)), 34);
    expect(await response.json()).toMatchObject({ count: 0, challenged: 34, stage_record_id: null });
    expect(fake.ballots.filter((b) => b.status === "CHALLENGED").every((b) => b.events.at(-1)!.reason === "Cross-check C3 failed")).toBe(true);
  });

  test("C4: a difference explained by a discard passes; an unexplained one challenges the batch", async () => {
    const county = await tallyCounty();
    expect((await countyBatch(county, "REPORTED_UNOFFICIAL", countyTotals("county_totals"), 34)).status).toBe(201);
    // Challenge one reported ballot (i = 0: cand-a, yes) and discard it.
    const ballot = fake.ballots[0]!;
    expect(fixtureChoices(0).contests.map((c) => c.choiceIds[0])).toEqual(["cand-a", "yes"]);
    fake.challenge(ballot.id);
    ballot.status = "DISCARDED";

    const unexplained = await countyBatch(county, "CERTIFIED", countyTotals("certified_totals"), 33);
    expect(await unexplained.json()).toMatchObject({ count: 0, challenged: 33 });
  });

  test("C4 passes when the certified totals leave out exactly the discarded ballot", async () => {
    const county = await tallyCounty();
    expect((await countyBatch(county, "REPORTED_UNOFFICIAL", countyTotals("county_totals"), 34)).status).toBe(201);
    const ballot = fake.ballots[0]!;
    fake.challenge(ballot.id);
    ballot.status = "DISCARDED";
    const certified = countyTotals("certified_totals", (t) => {
      const file = t as { ballotCount: number; contests: Array<{ selections: Array<{ selectionId: string; votes: number }> }> };
      file.ballotCount = 33;
      file.contests[0]!.selections.find((s) => s.selectionId === "cand-a")!.votes -= 1;
      file.contests[1]!.selections.find((s) => s.selectionId === "yes")!.votes -= 1;
    });
    const response = await countyBatch(county, "CERTIFIED", certified, 33);
    expect(await response.json()).toMatchObject({ count: 33, challenged: 0 });
  });
});
