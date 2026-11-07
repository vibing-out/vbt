import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ENV, event, fakeTrackerDb, seededData, type TrackerDbData } from "../../../../lib/testing/fake-tracker-db";
import { handleTrackRequest, MIN_RESPONSE_MS, NOT_FOUND_BODY } from "../../../../lib/track/handler";

// The route with its real wiring (lookup, rate limiter, minimum time); only the network is faked: the
// Firewall SDK is mocked and global fetch is the fake PostgREST.
const firewall = vi.hoisted(() => ({ checkRateLimit: vi.fn(async () => ({ rateLimited: false })) }));
vi.mock("@vercel/firewall", () => firewall);

const { GET } = await import("./route");

let db: ReturnType<typeof fakeTrackerDb>;
const useDb = (data: TrackerDbData = seededData(), options: { failOn?: string } = {}) => {
  db = fakeTrackerDb(data, options);
  vi.stubGlobal("fetch", db.fetch);
};

const call = (code: string) =>
  GET(new Request(`https://vbt.example/api/track/${encodeURIComponent(code)}`), { params: Promise.resolve({ code }) });

const timed = async (code: string) => {
  const start = performance.now();
  const response = await call(code);
  const text = await response.text();
  return { response, text, ms: performance.now() - start };
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV.NEXT_PUBLIC_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  firewall.checkRateLimit.mockReset().mockResolvedValue({ rateLimited: false });
  useDb();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("AC1: a valid code returns 200 with status, label, cast date, timeline and stages with a check", async () => {
  const { response, text } = await timed("seed-0001");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = JSON.parse(text);
  expect(body).toMatchObject({ trackingCode: "SEED-0001", status: "TALLIED_PRECINCT", label: "Counted at precinct", castDate: "2026-11-03" });
  expect(body.timeline.length).toBe(2);
  expect(body.stages.length).toBe(1);
  // The stub integrity checker: never a fake pass.
  expect(body.stages[0].check).toEqual({ state: "unavailable", proof: null });
  expect(firewall.checkRateLimit).toHaveBeenCalledWith("track-lookup", expect.objectContaining({ timeout: 1000 }));
});

test("AC2: unknown, malformed and database-error lookups give one byte-identical 404, each held to the minimum time", async () => {
  const unknown = await timed("SEED-9999");
  const malformed = await timed("SEED,0001)*");
  useDb(seededData(), { failOn: "ballot_event_public" });
  const dbError = await timed("SEED-0001");
  vi.unstubAllEnvs();
  const noEnv = await timed("SEED-0001");

  for (const r of [unknown, malformed, dbError, noEnv]) {
    expect(r.response.status).toBe(404);
    expect(r.response.headers.get("Cache-Control")).toBe("no-store");
    expect(r.text).toBe(unknown.text);
    expect(r.ms).toBeGreaterThanOrEqual(MIN_RESPONSE_MS - 5);
  }
  expect(JSON.parse(unknown.text)).toEqual({
    error: "not_found",
    message: "We couldn't find a ballot with that code. Check the code on your receipt and try again.",
  });
});

test("a malformed code never reaches the database", async () => {
  await call("SEED-0001&select=ciphertext");
  await call("eq.SEED-0001");
  expect(db.requests).toEqual([]);
});

test("AC10: a rate-limited request gets 429 with Retry-After and no ballot data, without touching the database", async () => {
  firewall.checkRateLimit.mockResolvedValue({ rateLimited: true });
  const { response, text } = await timed("SEED-0001");
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("30");
  expect(JSON.parse(text)).toEqual({ error: "rate_limited" });
  expect(text).not.toMatch(/SEED|TALLIED|ciphertext/i);
  expect(db.requests).toEqual([]);
});

test("fails open when the rate-limit check throws or times out", async () => {
  firewall.checkRateLimit.mockRejectedValue(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
  expect((await call("SEED-0001")).status).toBe(200);
});

test("AC4: the JSON holds no time of day, private columns, ciphertext or totals", async () => {
  const data = seededData();
  data.ballots[0]!.current_status = "DISCARDED";
  data.events.push(
    event({ hash: "c2", prev_hash: "f2", event_type: "STATUS_CHANGE", from_status: "TALLIED_PRECINCT", to_status: "CHALLENGED", reason: "Signature check" }),
    event({ hash: "c3", prev_hash: "c2", event_type: "CHALLENGE_RESOLVED", from_status: "CHALLENGED", to_status: "DISCARDED", reason: "Provisional ballot rejected" }),
  );
  useDb(data);
  const { response, text } = await timed("SEED-0001");
  expect(response.status).toBe(200);
  for (const forbidden of [/\d{1,2}:\d{2}/, /T\d{2}:\d{2}/, /occurred_at/, /recorded_at/, /published_at/, /batch_id/, /actor_id/, /ciphertext"/, /totals/, /seed-ciphertext/, /machine/i, /ballot_id/, /evt-/]) {
    expect(text).not.toMatch(forbidden);
  }
  // The DISCARDED reason is public and shown.
  expect(JSON.parse(text).timeline.at(-1)).toEqual({
    status: "DISCARDED",
    label: "Not counted (reason shown)",
    date: "2026-11-03",
    reason: "Provisional ballot rejected",
  });
});

test("handler: the minimum time is applied with an injected clock, and a throwing lookup is a plain 404", async () => {
  let clock = 0;
  const sleeps: number[] = [];
  const response = await handleTrackRequest(new Request("https://vbt.example/api/track/X"), "SEED-0001", {
    isRateLimited: async () => false,
    lookup: async () => {
      clock += 120;
      throw new Error("db down");
    },
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual(NOT_FOUND_BODY);
  expect(sleeps).toEqual([MIN_RESPONSE_MS - 120]);
});

test("handler: a slow lookup is not delayed further, and a throwing limiter fails open", async () => {
  let clock = 0;
  const sleeps: number[] = [];
  const response = await handleTrackRequest(new Request("https://vbt.example/api/track/X"), "SEED-0001", {
    isRateLimited: async () => {
      throw new Error("x");
    },
    lookup: async () => {
      clock += 900;
      return null;
    },
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  expect(response.status).toBe(404);
  expect(sleeps).toEqual([]);
});
