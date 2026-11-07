import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { recordApiUrl } from "../../../../../lib/record/links";
import { readPublishedRecord } from "../../../../../lib/record/read";
import { ENV, event, fakeTrackerDb, seededData, stageRecord } from "../../../../../lib/testing/fake-tracker-db";
import { GET } from "./route";

// The route with its real wiring; only the network is faked (global fetch is the fake PostgREST).
const ROOT = "3".repeat(64);
const SIG = Buffer.alloc(64, 9);

function data() {
  const d = seededData();
  d.ballots[0]!.ciphertext_hash = "4".repeat(64);
  d.stageRecords = [
    stageRecord({ stage: "TALLIED_PRECINCT", scope: "precinct", scope_id: "18097-001", merkle_root: ROOT, ballot_count: 1, signature: SIG.toString("base64") }),
  ];
  d.events.push(event({ hash: "zz", prev_hash: "f2", event_type: "CHALLENGE_RESOLVED", to_status: "TALLIED_PRECINCT" }));
  return d;
}

const call = (scope: string, stage: string) =>
  GET(new Request(`https://vbt.example${recordApiUrl(scope, stage as "CERTIFIED")}`), { params: Promise.resolve({ scope, stage }) });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV.NEXT_PUBLIC_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  vi.stubGlobal("fetch", fakeTrackerDb(data()).fetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("AC4: GET /api/record/{scope}/{stage} returns the published record, byte for byte what the reader builds", async () => {
  const response = await call("18097-001", "TALLIED_PRECINCT");
  expect(response.status).toBe(200);
  const body = await response.text();
  const expected = await readPublishedRecord("18097-001", "TALLIED_PRECINCT", { env: ENV, fetch: fakeTrackerDb(data()).fetch });
  expect(body).toBe(JSON.stringify(expected));
  expect(JSON.parse(body)).toEqual({
    scope: "precinct",
    scope_id: "18097-001",
    stage: "TALLIED_PRECINCT",
    merkle_root: ROOT,
    ballot_count: 1,
    totals: { mayor: { a: 9, b: 8 } },
    published_on: "2026-11-03",
    signature: SIG.toString("hex"),
    ballots: [{ tracking_code: "SEED-0001", ciphertext_hash: "4".repeat(64) }],
  });
});

test("an unpublished stage is 404; a failed read is 503", async () => {
  expect((await call("18097", "CERTIFIED")).status).toBe(404);
  vi.stubGlobal("fetch", fakeTrackerDb(data(), { failOn: "stage_records" }).fetch);
  expect((await call("18097-001", "TALLIED_PRECINCT")).status).toBe(503);
});
