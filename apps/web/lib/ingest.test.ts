import { type ChainedEvent, hashEvent, MISMATCH_REASON, parseRecordFile, sha256Hex } from "@vbt/events";
import { describe, expect, test } from "vitest";
import { ingestUpload, type Upload } from "./ingest";
import { DbError, type StoredBallot } from "./service-db";
import {
  COUNTY_OFFICIAL,
  fileBytes,
  KEY_ENV,
  memoryDb,
  OTHER_ELECTION_PUBLIC_KEY,
  recordFile,
  sealedBallots,
} from "./testing/election-fixtures";

const NOW = new Date("2026-11-04T15:00:00Z");
const env = { ...KEY_ENV, NEXT_PUBLIC_SUPABASE_URL: "https://demo.supabase.co", SUPABASE_SECRET_KEY: "s" };
const ballots = await sealedBallots(4);
const sealedElsewhere = await sealedBallots(1, { publicKey: OTHER_ELECTION_PUBLIC_KEY });

function upload(file: unknown): Upload {
  const bytes = fileBytes(file);
  const parsed = parseRecordFile(bytes);
  if (!parsed.ok) throw new Error(parsed.message);
  return { bytes, file: parsed.value };
}

type IngestPayload = {
  sha256: string;
  kind: string;
  actor_id: string;
  county_id: string;
  ballot_count: number;
  ballots: Array<{ tracking_code: string; ciphertext_hash: string; occurred_at: string; actor_role: string; actor_id: string; hash: string }>;
  mismatches: Array<{ tracking_code: string; expected_status: string; new_status: string | null; events: Array<ChainedEvent & Record<string, unknown>> }>;
};

const sent = (db: ReturnType<typeof memoryDb>) =>
  db.calls.find((c) => c.method === "ingestBallotRecord")?.args[0] as IngestPayload | undefined;

describe("a valid file (AC5)", () => {
  test("sends every new ballot with its CAST event, and the file's sha256 and count", async () => {
    const db = memoryDb();
    const u = upload(recordFile(ballots));
    const response = await ingestUpload(u, COUNTY_OFFICIAL, { env, db, now: () => NOW });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ file_id: "file-1", event_ids: ["event-1"] });

    const payload = sent(db)!;
    expect(payload).toMatchObject({ sha256: sha256Hex(u.bytes), kind: "ballot_record", actor_id: COUNTY_OFFICIAL.userId, county_id: "18097", ballot_count: 4 });
    expect(payload.mismatches).toEqual([]);
    payload.ballots.forEach((b, i) => {
      expect(b.tracking_code).toBe(ballots[i]!.tracking_code);
      expect(b.ciphertext_hash).toBe(sha256Hex(Buffer.from(ballots[i]!.ciphertext, "base64")));
      // C6, C19: the cast date at noon; the machine is the actor.
      expect(b.occurred_at).toBe("2026-11-03T12:00:00-05:00");
      expect([b.actor_role, b.actor_id]).toEqual(["machine", "M-18097-001-A"]);
      expect(b.hash).toBe(
        hashEvent({ tracking_code: b.tracking_code, event_type: "CAST", from_status: null, to_status: null, reason: null, occurred_on: "2026-11-03", prev_hash: null }),
      );
    });
  });

  test("a code already stored with the same ciphertext is skipped as a duplicate", async () => {
    const stored: StoredBallot = {
      ballot_id: "b-1",
      tracking_code: ballots[0]!.tracking_code,
      ciphertext_hash: sha256Hex(Buffer.from(ballots[0]!.ciphertext, "base64")),
      current_status: "CAST",
      precinct_id: "18097-001",
      county_id: "18097",
      head_hash: "a".repeat(64),
      heads: 1,
    };
    const db = memoryDb({ stored: [stored] });
    expect((await ingestUpload(upload(recordFile(ballots)), COUNTY_OFFICIAL, { env, db })).status).toBe(201);
    expect(sent(db)!.ballots.map((b) => b.tracking_code)).toEqual(ballots.slice(1).map((b) => b.tracking_code));
    expect(sent(db)!.mismatches).toEqual([]);
  });

  test("C4: the RPC refusing a file already uploaded is 409", async () => {
    const db = memoryDb({ ingest: () => Promise.reject(new DbError("VB409", "this file was already uploaded")) });
    const response = await ingestUpload(upload(recordFile(ballots)), COUNTY_OFFICIAL, { env, db });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "conflict", message: "this file was already uploaded" });
  });
});

describe("AC6: a stored code with a different ciphertext is a mismatch", () => {
  const stored = (status: string): StoredBallot => ({
    ballot_id: "b-1",
    tracking_code: ballots[0]!.tracking_code,
    ciphertext_hash: "f".repeat(64),
    current_status: status,
    precinct_id: "18097-001",
    county_id: "18097",
    head_hash: "a".repeat(64),
    heads: 1,
  });

  test("MISMATCH_DETECTED then STATUS_CHANGE -> CHALLENGED, chained on the stored head, by the official", async () => {
    const db = memoryDb({ stored: [stored("TALLIED_PRECINCT")] });
    expect((await ingestUpload(upload(recordFile(ballots)), COUNTY_OFFICIAL, { env, db, now: () => NOW })).status).toBe(201);
    const payload = sent(db)!;
    expect(payload.ballots).toHaveLength(3);
    const [mismatch] = payload.mismatches;
    expect(mismatch).toMatchObject({ tracking_code: ballots[0]!.tracking_code, expected_status: "TALLIED_PRECINCT", new_status: "CHALLENGED" });
    expect(mismatch!.events.map((e) => [e.event_type, e.from_status, e.to_status, e.reason, e.actor_role, e.actor_id])).toEqual([
      ["MISMATCH_DETECTED", null, null, MISMATCH_REASON, "county", COUNTY_OFFICIAL.userId],
      ["STATUS_CHANGE", "TALLIED_PRECINCT", "CHALLENGED", MISMATCH_REASON, "county", COUNTY_OFFICIAL.userId],
    ]);
    expect(mismatch!.events[0]!.prev_hash).toBe("a".repeat(64));
    expect(mismatch!.events[0]!.occurred_on).toBe("2026-11-04");
    expect(mismatch!.events.every((e) => e.occurred_at === NOW.toISOString())).toBe(true);
    // Each hash recomputes, and the second event chains on the first.
    const [first, second] = mismatch!.events;
    expect(first!.hash).toBe(hashEvent(first!));
    expect(second!.hash).toBe(hashEvent(second!));
    expect(second!.prev_hash).toBe(first!.hash);
  });

  test("an already CHALLENGED ballot gets only MISMATCH_DETECTED", async () => {
    const db = memoryDb({ stored: [stored("CHALLENGED")] });
    await ingestUpload(upload(recordFile(ballots)), COUNTY_OFFICIAL, { env, db });
    const [mismatch] = sent(db)!.mismatches;
    expect(mismatch!.new_status).toBeNull();
    expect(mismatch!.events.map((e) => e.event_type)).toEqual(["MISMATCH_DETECTED"]);
  });

  test("a stored ballot with a broken chain is 409, nothing written", async () => {
    const db = memoryDb({ stored: [{ ...stored("CAST"), heads: 2 }] });
    expect((await ingestUpload(upload(recordFile(ballots)), COUNTY_OFFICIAL, { env, db })).status).toBe(409);
    expect(sent(db)).toBeUndefined();
  });
});

describe("AC5: a bad file is 422 and nothing is written", () => {
  const cases: Array<[string, unknown, string]> = [
    ["a wrong tracking code", recordFile([{ ...ballots[0]!, tracking_code: "RIVER-MAPLE-7Q4K-HAWK" }]), "TRACKING_CODE_MISMATCH"],
    ["a wrong prev tracking code", recordFile([{ ...ballots[1]!, prev_tracking_code: null }]), "TRACKING_CODE_MISMATCH"],
    ["bad base64", recordFile([{ ...ballots[0]!, ciphertext: "not base64!" }]), "INVALID_CIPHERTEXT"],
    ["an unknown precinct", recordFile([{ ...ballots[0]!, precinct_id: "99999-001" }]), "UNKNOWN_PRECINCT"],
    ["a precinct outside the file's county", recordFile([{ ...ballots[0]!, precinct_id: "18057-001" }]), "PRECINCT_NOT_IN_COUNTY"],
    ["an unknown machine", recordFile([{ ...ballots[0]!, machine_id: "M-NOPE" }]), "UNKNOWN_MACHINE"],
    ["a machine from another precinct", recordFile([{ ...ballots[0]!, machine_id: "M-18097-002-A" }]), "MACHINE_NOT_IN_PRECINCT"],
    ["the same code twice", recordFile([ballots[0]!, ballots[0]!]), "DUPLICATE_TRACKING_CODE"],
    ["a ciphertext that won't open with the election key", recordFile(sealedElsewhere), "CIPHERTEXT_INVALID"],
    ["another election", recordFile(ballots, { election_id: "other-election" }), "WRONG_ELECTION"],
  ];

  test.each(cases)("%s", async (_name, file, code) => {
    const db = memoryDb();
    const response = await ingestUpload(upload(file), COUNTY_OFFICIAL, { env, db });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code });
    expect(sent(db)).toBeUndefined();
  });

  test("a ciphertext that won't open names its position, not its contents", async () => {
    const response = await ingestUpload(upload(recordFile([...ballots, ...sealedElsewhere])), COUNTY_OFFICIAL, { env, db: memoryDb() });
    expect(await response.json()).toEqual({ code: "CIPHERTEXT_INVALID", error: "ballot 4: sealed box failed to open" });
  });
});

test("C22: missing keys or service key is 500 server_misconfigured with no database call", async () => {
  for (const broken of [{ ...env, ELECTION_SECRET_KEY: undefined }, { ...env, ELECTION_PUBLIC_KEY: "AAAA" }]) {
    const db = memoryDb();
    const response = await ingestUpload(upload(recordFile(ballots)), COUNTY_OFFICIAL, { env: broken, db });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_misconfigured" });
    expect(db.calls).toEqual([]);
  }
  const noService = await ingestUpload(upload(recordFile(ballots)), COUNTY_OFFICIAL, { env: { ...env, SUPABASE_SECRET_KEY: undefined } });
  expect(noService.status).toBe(500);
});
