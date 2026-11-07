import { BALLOT_STATUSES, publicLabel } from "@vbt/domain";
import { expect, test } from "vitest";
import {
  CIPHERTEXT_HASH,
  ENV,
  event,
  fakeTrackerDb,
  seededData,
  stageRecord,
} from "../testing/fake-tracker-db";
import type { IntegrityChecker } from "./integrity";
import { lookupBallot } from "./lookup";

const passing: IntegrityChecker = { check: async () => ({ state: "passed", proof: { path: ["x"] } }) };
const failing: IntegrityChecker = { check: async () => ({ state: "failed", proof: null }) };

test("AC1: returns status, label, dated timeline and the precinct's published stage for a seeded-style ballot", async () => {
  const db = fakeTrackerDb();
  const result = await lookupBallot("SEED-0001", { env: ENV, fetch: db.fetch, checker: passing });
  expect(result).toEqual({
    trackingCode: "SEED-0001",
    status: "TALLIED_PRECINCT",
    label: "Counted at precinct",
    terminal: false,
    ciphertextHash: CIPHERTEXT_HASH,
    castDate: "2026-11-03",
    precinct: { id: "18097-001", name: "Center 1", countyId: "18097" },
    timeline: [
      { status: "CAST", label: "Cast and sealed", date: "2026-11-03", reason: null },
      { status: "TALLIED_PRECINCT", label: "Counted at precinct", date: "2026-11-03", reason: null },
    ],
    stages: [
      {
        stage: "TALLIED_PRECINCT",
        scope: "precinct",
        scopeId: "18097-001",
        merkleRoot: "root-TALLIED_PRECINCT",
        signature: "sig-base64",
        publishedOn: "2026-11-03",
        recordUrl: "/record#record-18097-001-TALLIED_PRECINCT",
        check: { state: "passed", proof: { path: ["x"] } },
      },
    ],
  });
});

test("queries only the four public endpoints, never private.* or the base ballots table", async () => {
  const db = fakeTrackerDb();
  await lookupBallot("SEED-0001", { env: ENV, fetch: db.fetch });
  expect(db.requests.length).toBe(4);
  for (const path of db.requests) {
    expect(path).toMatch(/^\/rest\/v1\/(ballot_public|ballot_event_public|precincts|stage_records)\?/);
    expect(path).not.toMatch(/private|\/ballots\?|ballot_events\?|occurred_at|recorded_at|ciphertext[^_]|totals|batch/);
  }
});

test("matches stage records by precinct or county scope and only for stages the ballot reached", async () => {
  const data = seededData();
  data.ballots[0]!.current_status = "REPORTED_UNOFFICIAL";
  data.events.push(event({ hash: "z3", prev_hash: "f2", event_type: "STATUS_CHANGE", from_status: "TALLIED_PRECINCT", to_status: "REPORTED_UNOFFICIAL" }));
  data.stageRecords.push(
    stageRecord({ stage: "REPORTED_UNOFFICIAL", scope: "county", scope_id: "18097" }),
    // Not reached yet, so not shown.
    stageRecord({ stage: "CERTIFIED", scope: "county", scope_id: "18097" }),
    // A precinct-scoped record whose id equals the county id must not match as a county record.
    stageRecord({ stage: "TALLIED_PRECINCT", scope: "precinct", scope_id: "18097", merkle_root: "wrong-scope" }),
  );
  const result = await lookupBallot("SEED-0001", { env: ENV, fetch: fakeTrackerDb(data).fetch });
  expect(result?.stages.map((s) => [s.stage, s.scope, s.scopeId, s.merkleRoot])).toEqual([
    ["TALLIED_PRECINCT", "precinct", "18097-001", "root-TALLIED_PRECINCT"],
    ["REPORTED_UNOFFICIAL", "county", "18097", "root-REPORTED_UNOFFICIAL"],
  ]);
});

test("passes passed and failed through from an injected checker", async () => {
  const pass = await lookupBallot("SEED-0001", { env: ENV, fetch: fakeTrackerDb().fetch, checker: passing });
  expect(pass?.stages.every((s) => s.check.state === "passed")).toBe(true);
  const fail = await lookupBallot("SEED-0001", { env: ENV, fetch: fakeTrackerDb().fetch, checker: failing });
  expect(fail?.stages.every((s) => s.check.state === "failed")).toBe(true);
});

test("AC11: the stub checker yields unavailable, never passed", async () => {
  const result = await lookupBallot("SEED-0001", { env: ENV, fetch: fakeTrackerDb().fetch });
  expect(result?.stages.length).toBeGreaterThan(0);
  for (const stage of result!.stages) expect(stage.check).toEqual({ state: "unavailable", proof: null });
});

test("a checker that throws or returns junk reports unavailable", async () => {
  const throwing: IntegrityChecker = { check: async () => { throw new Error("x"); } };
  const junk = { check: async () => ({ state: "yes" }) } as unknown as IntegrityChecker;
  for (const checker of [throwing, junk]) {
    const result = await lookupBallot("SEED-0001", { env: ENV, fetch: fakeTrackerDb().fetch, checker });
    expect(result?.stages[0]?.check.state).toBe("unavailable");
  }
});

test("a record reader's link is passed through", async () => {
  const result = await lookupBallot("SEED-0001", {
    env: ENV,
    fetch: fakeTrackerDb().fetch,
    records: { recordUrl: (r) => `/api/record/${r.scopeId}/${r.stage}` },
  });
  expect(result?.stages[0]?.recordUrl).toBe("/api/record/18097-001/TALLIED_PRECINCT");
});

test("T-08b AC1: by default each published stage links to its entry on /record", async () => {
  const data = seededData();
  data.ballots[0]!.current_status = "CERTIFIED";
  data.events.push(
    event({ hash: "b3", prev_hash: "f2", event_type: "STATUS_CHANGE", from_status: "TALLIED_PRECINCT", to_status: "REPORTED_UNOFFICIAL" }),
    event({ hash: "c4", prev_hash: "b3", event_type: "STATUS_CHANGE", from_status: "REPORTED_UNOFFICIAL", to_status: "CERTIFIED" }),
  );
  data.stageRecords.push(
    stageRecord({ stage: "REPORTED_UNOFFICIAL", scope: "county", scope_id: "18097" }),
    stageRecord({ stage: "CERTIFIED", scope: "county", scope_id: "18097" }),
  );
  const result = await lookupBallot("SEED-0001", { env: ENV, fetch: fakeTrackerDb(data).fetch });
  expect(result?.stages.map((s) => s.recordUrl)).toEqual([
    "/record#record-18097-001-TALLIED_PRECINCT",
    "/record#record-18097-REPORTED_UNOFFICIAL",
    "/record#record-18097-CERTIFIED",
  ]);
});

test("an unknown code returns null", async () => {
  expect(await lookupBallot("SEED-9999", { env: ENV, fetch: fakeTrackerDb().fetch })).toBeNull();
});

test.each(["ballot_public", "ballot_event_public", "precincts", "stage_records"])(
  "returns null when the %s read fails",
  async (table) => {
    expect(await lookupBallot("SEED-0001", { env: ENV, fetch: fakeTrackerDb(seededData(), { failOn: table }).fetch })).toBeNull();
  },
);

test("returns null when fetch throws or the env is missing", async () => {
  const throwing = (async () => { throw new TypeError("network"); }) as typeof fetch;
  expect(await lookupBallot("SEED-0001", { env: ENV, fetch: throwing })).toBeNull();
  expect(await lookupBallot("SEED-0001", { env: {}, fetch: fakeTrackerDb().fetch })).toBeNull();
});

test("DISCARDED and CHALLENGED carry their reason; other stages never do", async () => {
  const data = seededData();
  data.ballots[0]!.current_status = "DISCARDED";
  data.events.push(
    event({ hash: "c1", prev_hash: "f2", event_type: "MISMATCH_DETECTED", from_status: null, to_status: null, reason: "machine count differs" }),
    event({ hash: "c2", prev_hash: "c1", event_type: "STATUS_CHANGE", from_status: "TALLIED_PRECINCT", to_status: "CHALLENGED", reason: "Mismatch with paper ballot" }),
    event({ hash: "c3", prev_hash: "c2", event_type: "CHALLENGE_RESOLVED", from_status: "CHALLENGED", to_status: "DISCARDED", reason: "Provisional ballot: voter not registered" }),
  );
  const result = await lookupBallot("SEED-0001", { env: ENV, fetch: fakeTrackerDb(data).fetch });
  expect(result?.terminal).toBe(true);
  expect(result?.label).toBe(publicLabel("DISCARDED"));
  // The mismatch flag appears only through the CHALLENGED transition it creates.
  expect(result?.timeline).toEqual([
    { status: "CAST", label: "Cast and sealed", date: "2026-11-03", reason: null },
    { status: "TALLIED_PRECINCT", label: "Counted at precinct", date: "2026-11-03", reason: null },
    { status: "CHALLENGED", label: "Under review", date: "2026-11-03", reason: "Mismatch with paper ballot" },
    { status: "DISCARDED", label: "Not counted (reason shown)", date: "2026-11-03", reason: "Provisional ballot: voter not registered" },
  ]);
});

test("every status is labelled with publicLabel and terminal follows isTerminal", async () => {
  for (const status of BALLOT_STATUSES) {
    const data = seededData();
    data.ballots[0]!.current_status = status;
    const result = await lookupBallot("SEED-0001", { env: ENV, fetch: fakeTrackerDb(data).fetch });
    expect(result?.label).toBe(publicLabel(status));
    expect(result?.terminal).toBe(["CERTIFIED", "DISCARDED", "SPOILED"].includes(status));
  }
});

test("a non-date value from the database never reaches the result", async () => {
  const data = seededData();
  data.ballots[0]!.cast_date = "2026-11-03T07:45:00Z";
  data.events[0]!.occurred_on = "2026-11-03 07:45";
  const result = await lookupBallot("SEED-0001", { env: ENV, fetch: fakeTrackerDb(data).fetch });
  expect(JSON.stringify(result)).not.toMatch(/\d{1,2}:\d{2}/);
});
