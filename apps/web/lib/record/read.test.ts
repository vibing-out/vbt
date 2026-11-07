import { expect, test } from "vitest";
import { ENV, fakeTrackerDb, type TrackerDbData } from "../testing/fake-tracker-db";
import { listPublishedRecords, PAGE_SIZE, readPublishedRecord, RecordUnavailableError, signatureHex } from "./read";

const ROOT_P1 = "1".repeat(64);
const ROOT_COUNTY = "2".repeat(64);
const SIG_BYTES = Buffer.alloc(64, 7);
const SIG_B64 = SIG_BYTES.toString("base64");
const SIG_HEX = SIG_BYTES.toString("hex");
const hash = (n: number) => n.toString(16).padStart(64, "0");

function ballot(n: number, precinct: string) {
  return {
    id: `b-${precinct}-${n}`,
    tracking_code: `CODE-${precinct}-${n}`,
    ciphertext_hash: hash(1000 - n),
    precinct_id: precinct,
    cast_date: "2026-11-03",
    current_status: "REPORTED_UNOFFICIAL",
    ciphertext: "private",
  };
}

function change(ballotId: string, precinct: string, to: string, n: number) {
  return {
    id: `e-${ballotId}-${to}`,
    ballot_id: ballotId,
    precinct_id: precinct,
    county_id: "18097",
    event_type: "STATUS_CHANGE",
    from_status: null,
    to_status: to,
    reason: null,
    occurred_on: "2026-11-03",
    prev_hash: null,
    hash: hash(n),
    occurred_at: "2026-11-03T20:00:00Z",
  };
}

function data(): TrackerDbData {
  const p1 = [1, 2, 3].map((n) => ballot(n, "18097-001"));
  const p2 = [4, 5].map((n) => ballot(n, "18097-002"));
  return {
    ballots: [...p1, ...p2],
    events: [
      ...p1.map((b, i) => change(b.id, "18097-001", "TALLIED_PRECINCT", i)),
      ...p2.map((b, i) => change(b.id, "18097-002", "TALLIED_PRECINCT", 10 + i)),
      ...[...p1, ...p2].map((b, i) => change(b.id, b.precinct_id, "REPORTED_UNOFFICIAL", 20 + i)),
      // A ballot accepted after review returns with CHALLENGE_RESOLVED: not a batch member.
      { ...change("b-18097-001-1", "18097-001", "TALLIED_PRECINCT", 40), event_type: "CHALLENGE_RESOLVED" },
    ],
    precincts: [
      { id: "18097-001", county_id: "18097", name: "Center 1" },
      { id: "18097-002", county_id: "18097", name: "Center 2" },
      { id: "18057-001", county_id: "18057", name: "Fall Creek 1" },
    ],
    stageRecords: [
      {
        id: "sr-1",
        scope: "precinct",
        scope_id: "18097-001",
        stage: "TALLIED_PRECINCT",
        merkle_root: ROOT_P1,
        ballot_count: 3,
        totals: { mayor: { a: 2, b: 1 } },
        // 03:30 UTC on Nov 4 is still Nov 3 in Indiana.
        published_at: "2026-11-04T03:30:00Z",
        signature: SIG_B64,
      },
      {
        id: "sr-2",
        scope: "county",
        scope_id: "18097",
        stage: "REPORTED_UNOFFICIAL",
        merkle_root: ROOT_COUNTY,
        ballot_count: 5,
        totals: { mayor: { a: 3, b: 2 } },
        published_at: "2026-11-04T05:00:00Z",
        signature: SIG_HEX,
      },
    ],
  };
}

test("AC2/AC4: reads one record in the locked JSON shape, ballots in ciphertext-hash order", async () => {
  const db = fakeTrackerDb(data());
  const record = await readPublishedRecord("18097-001", "TALLIED_PRECINCT", { env: ENV, fetch: db.fetch });
  expect(record).toEqual({
    scope: "precinct",
    scope_id: "18097-001",
    stage: "TALLIED_PRECINCT",
    merkle_root: ROOT_P1,
    ballot_count: 3,
    totals: { mayor: { a: 2, b: 1 } },
    published_on: "2026-11-03",
    signature: SIG_HEX,
    ballots: [
      { tracking_code: "CODE-18097-001-3", ciphertext_hash: hash(997) },
      { tracking_code: "CODE-18097-001-2", ciphertext_hash: hash(998) },
      { tracking_code: "CODE-18097-001-1", ciphertext_hash: hash(999) },
    ],
  });
  // The locked key order, so the downloaded file reads like the documented shape.
  expect(Object.keys(record!)).toEqual([
    "scope", "scope_id", "stage", "merkle_root", "ballot_count", "totals", "published_on", "signature", "ballots",
  ]);
});

test("a county record lists every precinct's members", async () => {
  const record = await readPublishedRecord("18097", "REPORTED_UNOFFICIAL", { env: ENV, fetch: fakeTrackerDb(data()).fetch });
  expect(record?.ballots.map((b) => b.tracking_code)).toEqual([
    "CODE-18097-002-5",
    "CODE-18097-002-4",
    "CODE-18097-001-3",
    "CODE-18097-001-2",
    "CODE-18097-001-1",
  ]);
});

test("AC5: the record holds dates only, never a time, an event hash, a ballot id or a ciphertext", async () => {
  const db = fakeTrackerDb(data());
  const record = await readPublishedRecord("18097", "REPORTED_UNOFFICIAL", { env: ENV, fetch: db.fetch });
  const text = JSON.stringify(record);
  expect(text).not.toMatch(/T\d{2}:\d{2}/);
  expect(text).not.toMatch(/published_at|occurred|b-18097|private/);
  // Only public columns are read (the fake refuses private ones).
  expect(db.requests.every((r) => !/ciphertext[,&]|occurred_at|batch_id/.test(decodeURIComponent(r)))).toBe(true);
});

test("an unpublished stage, an unknown scope and a bad scope id are null", async () => {
  const deps = { env: ENV, fetch: fakeTrackerDb(data()).fetch };
  expect(await readPublishedRecord("18097-002", "TALLIED_PRECINCT", deps)).toBeNull();
  expect(await readPublishedRecord("18097", "CERTIFIED", deps)).toBeNull();
  expect(await readPublishedRecord("../etc", "CERTIFIED", deps)).toBeNull();
});

test("no database env reads as nothing published", async () => {
  expect(await readPublishedRecord("18097-001", "TALLIED_PRECINCT", { env: {} })).toBeNull();
  expect(await listPublishedRecords({ env: {} })).toBeNull();
});

test("a ballot list that doesn't match ballot_count is unavailable, never served wrong", async () => {
  const d = data();
  d.stageRecords[0]!.ballot_count = 4;
  await expect(readPublishedRecord("18097-001", "TALLIED_PRECINCT", { env: ENV, fetch: fakeTrackerDb(d).fetch })).rejects.toBeInstanceOf(
    RecordUnavailableError,
  );
});

test("a failed read is unavailable", async () => {
  const deps = { env: ENV, fetch: fakeTrackerDb(data(), { failOn: "ballot_public" }).fetch };
  await expect(readPublishedRecord("18097-001", "TALLIED_PRECINCT", deps)).rejects.toBeInstanceOf(RecordUnavailableError);
  await expect(listPublishedRecords({ env: ENV, fetch: fakeTrackerDb(data(), { failOn: "stage_records" }).fetch })).rejects.toBeInstanceOf(
    RecordUnavailableError,
  );
});

test("of two rows for one scope and stage, the later published one is served", async () => {
  const d = data();
  d.stageRecords.push({ ...d.stageRecords[0]!, id: "sr-0", merkle_root: "0".repeat(64), published_at: "2026-11-03T20:00:00Z" });
  const record = await readPublishedRecord("18097-001", "TALLIED_PRECINCT", { env: ENV, fetch: fakeTrackerDb(d).fetch });
  expect(record?.merkle_root).toBe(ROOT_P1);
});

test("AC2: lists every published record with its county, skipping malformed or unsigned rows", async () => {
  const d = data();
  d.stageRecords.push(
    { ...d.stageRecords[0]!, id: "sr-x", scope_id: "18097-002", signature: null },
    { ...d.stageRecords[0]!, id: "sr-y", scope_id: "18057-001", merkle_root: "not-hex" },
    { ...d.stageRecords[0]!, id: "sr-z", scope: "county", scope_id: "18057" }, // scope doesn't match the stage
  );
  const listing = await listPublishedRecords({ env: ENV, fetch: fakeTrackerDb(d).fetch });
  expect(listing).toEqual([
    {
      countyId: "18097",
      record: {
        scope: "precinct",
        scope_id: "18097-001",
        stage: "TALLIED_PRECINCT",
        merkle_root: ROOT_P1,
        ballot_count: 3,
        totals: { mayor: { a: 2, b: 1 } },
        published_on: "2026-11-03",
        signature: SIG_HEX,
      },
    },
    {
      countyId: "18097",
      record: {
        scope: "county",
        scope_id: "18097",
        stage: "REPORTED_UNOFFICIAL",
        merkle_root: ROOT_COUNTY,
        ballot_count: 5,
        totals: { mayor: { a: 3, b: 2 } },
        published_on: "2026-11-04",
        signature: SIG_HEX,
      },
    },
  ]);
});

test("reads page past PostgREST's row limit", async () => {
  const d = data();
  const many = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ballot(100 + i, "18097-001"));
  // Distinct hashes for the extra ballots.
  many.forEach((b, i) => (b.ciphertext_hash = (5000 + i).toString(16).padStart(64, "0")));
  d.ballots.push(...many);
  d.events.push(...many.map((b, i) => change(b.id, "18097-001", "TALLIED_PRECINCT", 100 + i)));
  d.stageRecords[0]!.ballot_count = 3 + many.length;
  const record = await readPublishedRecord("18097-001", "TALLIED_PRECINCT", { env: ENV, fetch: fakeTrackerDb(d).fetch });
  expect(record?.ballots).toHaveLength(3 + many.length);
});

test("signatureHex turns a stored base64 signature into lowercase hex and refuses anything else", () => {
  expect(signatureHex(SIG_B64)).toBe(SIG_HEX);
  expect(signatureHex(SIG_HEX)).toBe(SIG_HEX);
  for (const bad of [null, "", "c2ln", Buffer.alloc(32).toString("base64"), "AB".repeat(64)]) {
    expect(signatureHex(bad)).toBeNull();
  }
});
