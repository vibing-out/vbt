import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fakeDb } from "../../../lib/testing/fake-db";
import { aal2, accessToken, ENV, fakeSupabase, LIVE_SESSION, USERS } from "../../../lib/testing/fake-supabase";
import { bearer, fixture, fixtureJson, jsonBytes, multipart } from "../../../lib/testing/requests";

// T-09 AC6 and AC2: POST /api/events records the SHA-256 of an uploaded export.
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/service-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/service-db")>()),
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

const LOG = fixture("cdf-M-18097-001-A.json");
const upload = (token: string | null, query: string, kind: string, bytes: Uint8Array = LOG, field = "file") =>
  POST(multipart(`https://vbt.example/api/events${query}`, { kind }, [[field, bytes]], token ? bearer(token) : {}));

test("AC6: records sha256(file) and returns its id; a re-upload returns the same id", async () => {
  const token = await aal2(USERS.pollWorker);
  const first = await upload(token, "?precinct=18097-001", "machine_log");
  expect(first.status).toBe(201);
  const body = await first.json();
  expect(body).toEqual({ id: expect.any(String), kind: "machine_log", scope_id: "18097-001", file_sha256: createHash("sha256").update(LOG).digest("hex") });
  const again = await upload(token, "?precinct=18097-001", "machine_log");
  expect((await again.json()).id).toBe(body.id);
  expect(fake.uploads).toHaveLength(1);
  expect(fake.uploads[0]!.uploaded_by).toBe(USERS.pollWorker);
});

test("AC6: each totals kind is accepted for its scope", async () => {
  const county = await aal2(USERS.county);
  expect((await upload(county, "?precinct=18097-001", "precinct_totals", fixture("totals-precinct-18097-001.json"))).status).toBe(201);
  expect((await upload(county, "?county=18097", "county_totals", fixture("totals-county-18097.json"))).status).toBe(201);
  expect((await upload(county, "?county=18097", "certified_totals", fixture("totals-certified-18097.json"))).status).toBe(201);
  expect(fake.uploads.map((u) => u.kind)).toEqual(["precinct_totals", "county_totals", "certified_totals"]);
});

test("AC6: malformed files, devices outside the precinct, wrong kinds or scopes return 400 and record nothing", async () => {
  const token = await aal2(USERS.county);
  const outside = fixtureJson<{ ElectionEventLog: { Device: Array<{ Id: string }> } }>("cdf-M-18097-001-A.json");
  outside.ElectionEventLog.Device[0]!.Id = "M-18097-002-A";
  for (const response of [
    await upload(token, "?precinct=18097-001", "machine_log", new TextEncoder().encode("{")),
    await upload(token, "?precinct=18097-001", "machine_log", jsonBytes(outside)),
    await upload(token, "?precinct=18097-001", "cvr"),
    await upload(token, "?county=18097", "machine_log"),
    await upload(token, "?precinct=18097-001", "precinct_totals", fixture("totals-county-18097.json")),
    await upload(token, "?precinct=18097-001", "machine_log", LOG, "other"),
    await upload(token, "?precinct=18097-001", "machine_log", new Uint8Array(1024 * 1024 + 1)),
  ]) {
    expect(response.status).toBe(400);
  }
  expect(fake.writes()).toEqual([]);
});

test("AC2: 403 without an aal2 official in scope", async () => {
  expect((await upload(null, "?precinct=18097-001", "machine_log")).status).toBe(403);
  expect((await upload(await accessToken({ sub: USERS.pollWorker, aal: "aal1" }), "?precinct=18097-001", "machine_log")).status).toBe(403);
  expect((await upload(await aal2(USERS.noGrant), "?precinct=18097-001", "machine_log")).status).toBe(403);
  expect((await upload(await aal2(USERS.pollWorker), "?precinct=18097-002", "machine_log")).status).toBe(403);
  expect((await upload(await aal2(USERS.pollWorker), "?county=18097", "county_totals")).status).toBe(403);
  expect((await upload(await aal2(USERS.pollWorker), "", "machine_log")).status).toBe(403);
  vi.stubGlobal("fetch", fakeSupabase({ revokedSessions: [LIVE_SESSION] }).fetch);
  expect((await upload(await aal2(USERS.pollWorker), "?precinct=18097-001", "machine_log")).status).toBe(403);
  expect(fake.calls).toEqual([]);
});
