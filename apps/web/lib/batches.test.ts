import { computeTrackingCode, verifyInclusionProof, verifyStageRecord } from "@vbt/crypto";
import { hashEvent, sha256Hex, stageLeaf } from "@vbt/events";
import { describe, expect, test } from "vitest";
import { buildBatch, checkBatchTransition, parseBatchRequest, runBatch, stageTree } from "./batches";
import { DbError } from "./service-db";
import { COUNTY_OFFICIAL, KEY_ENV, KEYS, memoryDb, membersOf, POLL_WORKER, sealedBallots, SIGNING_PUBLIC_KEY } from "./testing/election-fixtures";

const NOW = new Date("2026-11-04T02:15:00Z"); // 21:15 on Nov 3 in Indiana
const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const ballots = await sealedBallots(12);
const members = membersOf(ballots, (code) => sha256Hex(`head-${code}`));
const precinctClose = { scope: "precinct", scope_id: "18097-001", from_status: "CAST", to_status: "TALLIED_PRECINCT" } as const;

const build = () =>
  buildBatch({ request: precinctClose, from: "CAST", to: "TALLIED_PRECINCT", members, official: POLL_WORKER, keys: KEYS, now: NOW, batchId: BATCH_ID });

const flip = (bytes: Uint8Array, i: number) => {
  const copy = bytes.slice();
  copy[i] = (copy[i] ?? 0) ^ 0x01;
  return copy;
};

describe("the stage record (AC1, C16)", () => {
  test("AC1: is signed over scope, stage, root, count and totals, and the signature verifies", async () => {
    const built = await build();
    expect(built.record).toEqual({
      scope: "precinct",
      stage: "TALLIED_PRECINCT",
      merkleRoot: built.tree.root,
      ballotCount: 12,
      totals: {
        "contest-president": { "cand-a": 6, "cand-b": 3, "cand-c": 3 },
        "contest-measure-1": { yes: 6, no: 6 },
      },
    });
    expect(built.tree.root).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyStageRecord(built.record, Buffer.from(built.signature, "base64"), SIGNING_PUBLIC_KEY)).toBe(true);
  });

  test("AC1: the payload is one STATUS_CHANGE per ballot, chained on its head, with the batch id as the record id", async () => {
    const { payload } = await build();
    expect(payload).toMatchObject({
      batch_id: BATCH_ID,
      scope: "precinct",
      scope_id: "18097-001",
      from_status: "CAST",
      to_status: "TALLIED_PRECINCT",
      actor_role: "poll_worker",
      actor_id: POLL_WORKER.userId,
      occurred_at: NOW.toISOString(),
      stage_record: { ballot_count: 12 },
    });
    const events = payload.events as Array<{ ballot_id: string; prev_hash: string; hash: string }>;
    expect(events).toHaveLength(12);
    events.forEach((event, i) => {
      const m = members[i]!;
      expect(event.ballot_id).toBe(m.ballot_id);
      expect(event.prev_hash).toBe(m.head_hash);
      // The Indiana date, not the UTC one.
      expect(event.hash).toBe(
        hashEvent({
          tracking_code: m.tracking_code,
          event_type: "STATUS_CHANGE",
          from_status: "CAST",
          to_status: "TALLIED_PRECINCT",
          reason: null,
          occurred_on: "2026-11-03",
          prev_hash: m.head_hash,
        }),
      );
    });
  });

  test("AC3: changing one total or the ballot count breaks the signature", async () => {
    const { record, signature } = await build();
    const sig = Buffer.from(signature, "base64");
    const totals = structuredClone(record.totals);
    totals["contest-president"]!["cand-a"]! += 1;
    expect(await verifyStageRecord({ ...record, totals }, sig, SIGNING_PUBLIC_KEY)).toBe(false);
    expect(await verifyStageRecord({ ...record, ballotCount: 13 }, sig, SIGNING_PUBLIC_KEY)).toBe(false);
    expect(await verifyStageRecord({ ...record, merkleRoot: "0".repeat(64) }, sig, SIGNING_PUBLIC_KEY)).toBe(false);
  });

  test("a stored ciphertext that no longer matches its hash stops the batch", async () => {
    const bad = members.map((m, i) => (i === 4 ? { ...m, ciphertext: ballots[5]!.ciphertext } : m));
    await expect(
      buildBatch({ request: precinctClose, from: "CAST", to: "TALLIED_PRECINCT", members: bad, official: POLL_WORKER, keys: KEYS, now: NOW, batchId: BATCH_ID }),
    ).rejects.toThrow(/does not match its hash/);
  });
});

describe("inclusion proofs (AC2, AC3)", () => {
  test("AC2: every ballot's leaf and proof verify against the published root, and fail against another root", async () => {
    const { tree } = await build();
    const other = stageTree(members.slice(1)).root;
    for (const m of members) {
      const index = tree.ordered.findIndex((o) => o.tracking_code === m.tracking_code);
      const leaf = stageLeaf(m.tracking_code, m.ciphertext_hash);
      expect(leaf).toEqual(tree.leaves[index]);
      expect(verifyInclusionProof(leaf, tree.proofs[index]!, Buffer.from(tree.root, "hex"))).toBe(true);
      expect(verifyInclusionProof(leaf, tree.proofs[index]!, Buffer.from(other, "hex"))).toBe(false);
    }
  });

  test("AC2: the root depends only on the ballots, never on their order", () => {
    expect(stageTree([...members].reverse()).root).toBe(stageTree(members).root);
    const hashes = stageTree(members).ordered.map((m) => m.ciphertext_hash);
    expect(hashes).toEqual([...hashes].sort());
  });

  test("AC3: flipping one ciphertext byte changes its hash, breaks its proof and its tracking code", async () => {
    const { tree } = await build();
    const target = tree.ordered[3]!;
    const source = ballots.find((b) => b.tracking_code === target.tracking_code)!;
    const bytes = new Uint8Array(Buffer.from(source.ciphertext, "base64"));
    const tampered = flip(bytes, 40);
    const tamperedHash = sha256Hex(tampered);
    expect(tamperedHash).not.toBe(target.ciphertext_hash);
    expect(verifyInclusionProof(stageLeaf(target.tracking_code, tamperedHash), tree.proofs[3]!, Buffer.from(tree.root, "hex"))).toBe(false);
    expect(computeTrackingCode(bytes, source.prev_tracking_code)).toBe(source.tracking_code);
    expect(computeTrackingCode(tampered, source.prev_tracking_code)).not.toBe(source.tracking_code);
  });
});

describe("request checks (C14)", () => {
  test("parseBatchRequest accepts the four fields and refuses other shapes", () => {
    expect(parseBatchRequest(precinctClose)).toEqual(precinctClose);
    for (const body of [null, [], "x", { ...precinctClose, scope: "state" }, { ...precinctClose, scope_id: "" }, { ...precinctClose, to_status: 3 }]) {
      expect(parseBatchRequest(body)).toBeNull();
    }
  });

  test.each([
    ["CAST", "CERTIFIED", "county", "NOT_BATCH_TRANSITION"],
    ["CAST", "CHALLENGED", "precinct", "NOT_BATCH_TRANSITION"],
    ["LOST", "CAST", "precinct", "INVALID_STATUS"],
    ["CAST", "LOST", "precinct", "INVALID_STATUS"],
    ["TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "precinct", "INVALID_BATCH_SCOPE"],
    ["CAST", "TALLIED_PRECINCT", "county", "INVALID_BATCH_SCOPE"],
  ] as const)("AC4: %s -> %s per %s is %s", (from, to, scope, code) => {
    const result = checkBatchTransition({ scope, scope_id: "x", from_status: from, to_status: to });
    expect(result.ok ? null : result.code).toBe(code);
  });

  test.each([
    ["CAST", "TALLIED_PRECINCT", "precinct"],
    ["TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "county"],
    ["REPORTED_UNOFFICIAL", "CERTIFIED", "county"],
  ] as const)("%s -> %s per %s is allowed", (from, to, scope) => {
    expect(checkBatchTransition({ scope, scope_id: "x", from_status: from, to_status: to }).ok).toBe(true);
  });
});

describe("runBatch", () => {
  const env = { ...KEY_ENV, NEXT_PUBLIC_SUPABASE_URL: "https://demo.supabase.co", SUPABASE_SECRET_KEY: "s" };

  test("AC4: an invalid transition is 422 with the domain code, and the database is never called", async () => {
    const db = memoryDb({ members });
    const response = await runBatch({ ...precinctClose, to_status: "CERTIFIED" }, POLL_WORKER, { env, db });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "NOT_BATCH_TRANSITION" });
    expect(db.calls).toEqual([]);
  });

  test("C15: an empty batch is 422 NO_BALLOTS and publishes nothing", async () => {
    const db = memoryDb({ members: [] });
    const response = await runBatch(precinctClose, POLL_WORKER, { env, db });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "NO_BALLOTS" });
    expect(db.calls.map((c) => c.method)).toEqual(["batchMembers"]);
  });

  test("C11: apply_batch raising (data changed) is 409", async () => {
    const db = memoryDb({ members, apply: () => Promise.reject(new DbError("VB409", "the batch's ballots changed since they were read")) });
    const response = await runBatch(precinctClose, POLL_WORKER, { env, db });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "conflict", message: "the batch's ballots changed since they were read" });
  });

  test("an unexpected database error is a generic 500", async () => {
    const db = memoryDb({ members, apply: () => Promise.reject(new DbError("XX000", "secret internals")) });
    const response = await runBatch(precinctClose, POLL_WORKER, { env, db });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal_error" });
  });

  test("a ballot with a broken chain is 409 and nothing is written", async () => {
    const db = memoryDb({ members: members.map((m, i) => (i === 0 ? { ...m, heads: 2 } : m)) });
    expect((await runBatch(precinctClose, POLL_WORKER, { env, db })).status).toBe(409);
    expect(db.calls.map((c) => c.method)).toEqual(["batchMembers"]);
  });

  test("C22: a missing or wrong-length key is 500 server_misconfigured and nothing is read or written", async () => {
    for (const broken of [{ ...env, STAGE_SIGNING_SECRET_KEY: "" }, { ...env, ELECTION_SECRET_KEY: "AAAA" }]) {
      const db = memoryDb({ members });
      const response = await runBatch(precinctClose, POLL_WORKER, { env: broken, db });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "server_misconfigured" });
      expect(db.calls).toEqual([]);
    }
  });

  test("success: 201 with the batch id, count and the stage record (id = batch id)", async () => {
    const db = memoryDb({ members });
    const response = await runBatch(precinctClose, COUNTY_OFFICIAL, { env, db, now: () => NOW, batchId: () => BATCH_ID });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      batch_id: BATCH_ID,
      ballot_count: 12,
      stage_record: { id: BATCH_ID, merkle_root: stageTree(members).root, signature: expect.any(String) },
    });
    const sent = db.calls.find((c) => c.method === "applyBatch")!.args[0] as { actor_role: string; stage_record: { signature: string } };
    expect(sent.actor_role).toBe("county");
    expect(sent.stage_record.signature).toBe(body.stage_record.signature);
  });
});
