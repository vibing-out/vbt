import { MISMATCH_REASON } from "@vbt/domain";
import { beforeAll, expect, test } from "vitest";
import { buildRows, CAST_AT, readKeys, type SeedRows, TALLY_AT } from "./build.ts";
import { E3_PENDING, pendingCrypto } from "./crypto-adapter.ts";
import { buildPlan } from "./plan.ts";
import { FAKE_KEY_ENV, type FakeCrypto, fakeCrypto } from "./testing/fake-crypto.ts";

const plan = buildPlan({ ballots: 200, precincts: 4, rate: 0.05, seed: "build-test" });
const keys = readKeys(FAKE_KEY_ENV);
let rows: SeedRows;
let crypto: FakeCrypto;

beforeAll(async () => {
  crypto = fakeCrypto();
  rows = await buildRows(plan, crypto, keys);
});

const eventsOf = (ballotId: string) => {
  // Rows are stored hash-sorted; rebuild each ballot's chain from prev_hash.
  const mine = rows.events.filter((e) => e.ballot_id === ballotId);
  const chain = [mine.find((e) => e.prev_hash === null)!];
  while (chain.length < mine.length) chain.push(mine.find((e) => e.prev_hash === chain.at(-1)!.hash)!);
  return chain;
};

test("with pendingCrypto the build throws E3_PENDING before producing any row", async () => {
  await expect(buildRows(plan, pendingCrypto, keys)).rejects.toThrow(E3_PENDING);
});

test("tracking codes chain per machine; each machine's first code chains to null", () => {
  for (const precinct of plan.precincts) {
    const ballots = rows.ballots.filter((b) => b.machine_id === precinct.machineId);
    const firsts = ballots.filter((b) => b.prev_tracking_code === null);
    expect(firsts).toHaveLength(1);
    // Walk the chain: every ballot is reached exactly once.
    const byPrev = new Map(ballots.map((b) => [b.prev_tracking_code, b]));
    let at = firsts[0];
    let n = 0;
    while (at) {
      n += 1;
      at = byPrev.get(at.tracking_code);
    }
    expect(n).toBe(ballots.length);
  }
  expect(crypto.prevCodes.filter((p) => p === null)).toHaveLength(4);
});

test("every ballot is stored with its ciphertext, its hash and the cast date", () => {
  expect(rows.ballots).toHaveLength(200);
  for (const b of rows.ballots) {
    expect(b.ciphertext_hash).toBe(crypto.ciphertextHash(new Uint8Array(Buffer.from(b.ciphertext, "base64"))));
    expect(b.cast_date).toBe("2026-11-03");
    expect(b.ballot_style).toBe("general-2026");
  }
});

test("mismatched ballots get CAST, MISMATCH_DETECTED, STATUS_CHANGE CAST→CHALLENGED, chained", () => {
  const flagged = rows.statuses.filter((s) => s.mismatch);
  expect(flagged).toHaveLength(10);
  for (const s of flagged) {
    expect(s.current_status).toBe("CHALLENGED");
    const chain = eventsOf(s.id);
    expect(chain.map((e) => [e.event_type, e.from_status, e.to_status])).toEqual([
      ["CAST", null, null],
      ["MISMATCH_DETECTED", null, null],
      ["STATUS_CHANGE", "CAST", "CHALLENGED"],
    ]);
    expect(chain.slice(1).map((e) => e.reason)).toEqual([MISMATCH_REASON, MISMATCH_REASON]);
    expect(chain.every((e) => e.batch_id === null)).toBe(true);
  }
});

test("tallied ballots get the precinct batch's STATUS_CHANGE with its batch_id", () => {
  const batchOf = new Map(rows.batches.map((b) => [b.scope_id, b.id]));
  for (const s of rows.statuses.filter((x) => !x.mismatch)) {
    expect(s.current_status).toBe("TALLIED_PRECINCT");
    const ballot = rows.ballots.find((b) => b.id === s.id)!;
    const chain = eventsOf(s.id);
    expect(chain.map((e) => [e.event_type, e.from_status, e.to_status])).toEqual([
      ["CAST", null, null],
      ["STATUS_CHANGE", "CAST", "TALLIED_PRECINCT"],
    ]);
    expect(chain[1]?.batch_id).toBe(batchOf.get(ballot.precinct_id));
  }
});

test("event hashes chain and cover only public fields with the date, never the time", () => {
  const ballot = rows.ballots[0]!;
  const chain = eventsOf(ballot.id);
  chain.forEach((e, i) => {
    expect(e.prev_hash).toBe(i === 0 ? null : chain[i - 1]!.hash);
    expect(e.hash).toBe(
      crypto.eventHash({
        prevHash: e.prev_hash,
        ballotId: e.ballot_id,
        precinctId: e.precinct_id,
        countyId: e.county_id,
        eventType: e.event_type,
        fromStatus: e.from_status,
        toStatus: e.to_status,
        reason: e.reason,
        occurredOn: "2026-11-03",
      }),
    );
  });
  expect(new Set(rows.events.map((e) => e.occurred_at))).toEqual(new Set([CAST_AT, TALLY_AT]));
});

test("one batch and one stage record per precinct; ballot_count leaves the mismatches out", () => {
  expect(rows.batches).toHaveLength(4);
  expect(rows.stageRecords).toHaveLength(4);
  for (const p of plan.precincts) {
    const total = plan.ballots.filter((b) => b.precinctId === p.id).length;
    const flagged = plan.ballots.filter((b) => b.precinctId === p.id && b.mismatch).length;
    expect(rows.batches.find((b) => b.scope_id === p.id)?.ballot_count).toBe(total - flagged);
    const record = rows.stageRecords.find((r) => r.scope_id === p.id)!;
    expect(record.ballot_count).toBe(total - flagged);
    expect(record.stage).toBe("TALLIED_PRECINCT");
    // Totals: one selection per contest per tallied ballot.
    for (const contest of Object.values(record.totals)) {
      expect(Object.values(contest).reduce((a, b) => a + b, 0)).toBe(total - flagged);
    }
  }
});

test("Merkle leaves are the tallied ballots' ciphertext hashes, sorted", () => {
  expect(crypto.merkleCalls).toHaveLength(4);
  plan.precincts.forEach((p, i) => {
    const expected = rows.ballots
      .filter((b) => b.precinct_id === p.id && !rows.statuses.find((s) => s.id === b.id)!.mismatch)
      .map((b) => b.ciphertext_hash)
      .sort();
    expect(crypto.merkleCalls[i]).toEqual(expected);
  });
});

test("ballots and events are ordered by hash, not by casting order", () => {
  const hashes = rows.ballots.map((b) => b.ciphertext_hash);
  expect(hashes).toEqual([...hashes].sort());
  const eventHashes = rows.events.map((e) => e.hash);
  expect(eventHashes).toEqual([...eventHashes].sort());
});

test("a malformed tracking code, a duplicate code, a bad hash or a failing signature stops the build", async () => {
  const bad = (override: Partial<FakeCrypto>) => buildRows(plan, { ...fakeCrypto(), ...override }, keys);
  await expect(bad({ computeTrackingCode: () => "not-a-code" })).rejects.toThrow(/malformed tracking code/);
  await expect(bad({ computeTrackingCode: () => "AMBER-BIRCH-0000-FAKE" })).rejects.toThrow(/duplicate tracking code/);
  await expect(bad({ ciphertextHash: () => "XYZ" })).rejects.toThrow(/ciphertext hash/);
  await expect(bad({ eventHash: () => "" })).rejects.toThrow(/event hash/);
  await expect(bad({ verifyStageRecord: async () => false })).rejects.toThrow(/does not verify/);
});

test("readKeys names a missing or malformed key without echoing its value", () => {
  expect(() => readKeys({ ...FAKE_KEY_ENV, ELECTION_SECRET_KEY: undefined })).toThrow("ELECTION_SECRET_KEY is not set");
  expect(() => readKeys({ ...FAKE_KEY_ENV, STAGE_SIGNING_SECRET_KEY: "not base64!secretvalue" })).toThrow(
    /^STAGE_SIGNING_SECRET_KEY is not base64$/,
  );
});
