import { describe, expect, test } from "vitest";
import { ApiError, type ApiPort } from "./ports.ts";
import { type StubOptions, WRITE_METHODS } from "./stubs.ts";
import { fakeClock, seededWorld } from "./testing.ts";
import {
  checkSet,
  DEADLINE_SECONDS,
  isUnsupportedSpoil,
  READBACK_MS,
  REJECT_REASON,
  type RunLine,
  runTimeline,
  STEPS,
} from "./timeline.ts";

// The whole 3-minute timeline on a fake clock whose sleeps return at once, so each test runs in
// milliseconds (CLAUDE.md: ticket CI within 5 minutes; human decision 1: injected clock).

async function run(options: StubOptions = {}) {
  const clock = fakeClock(1_000_000);
  const { world, seed } = await seededWorld(clock, options);
  const before = world.calls().length;
  const eventsBefore = world.events().length;
  const check = await checkSet(world.api, seed.setId);
  if (!check.ok) throw new Error(check.message);
  const codes = check.set.codes;
  const lines: RunLine[] = [];
  const snapshots: ReturnType<typeof world.events>[] = [];
  const start = clock.now();
  const result = await runTimeline({
    api: world.api,
    simulator: world.simulator,
    clock,
    set: check.set,
    onLine: (line) => {
      lines.push(line);
      snapshots.push(world.events());
    },
  });
  const calls = world.calls().slice(before);
  const seconds = (at: number) => (at - start) / 1000;
  const writes = calls.filter((c) => WRITE_METHODS.includes(c.method));
  return { clock, world, seed, check, codes, lines, snapshots, result, calls, writes, seconds, eventsBefore, start };
}

const steps = (lines: RunLine[]) => lines.filter((l) => l.type === "step");

describe("the fixed timeline (AC 3)", () => {
  test("the steps are at 0:20, 0:45, 1:30, 2:00 and 2:40, with a 3:10 deadline", () => {
    expect(STEPS.map((s) => [s.id, s.at])).toEqual([
      ["spoil-d", 20],
      ["precinct-tally", 45],
      ["election-night", 90],
      ["reject-e", 120],
      ["certify", 160],
    ]);
    expect(DEADLINE_SECONDS).toBe(190);
    expect(REJECT_REASON).toBe("machine record did not match the paper ballot");
  });

  test("writes happen at 20, 45, 45, 90, 120 and 160 s and the run finishes within 190 s", async () => {
    const { writes, seconds, result } = await run();
    expect(writes.map((w) => [w.method, seconds(w.at)])).toEqual([
      ["uploadEventsFile", 20],
      ["uploadEventsFile", 45],
      ["createBatch", 45],
      ["createBatch", 90],
      ["resolveChallenge", 120],
      ["createBatch", 160],
    ]);
    expect(result.ok).toBe(true);
    expect(result.overran).toBe(false);
    expect(result.finishedAt).toBeLessThanOrEqual(DEADLINE_SECONDS);
  });

  test("final state: A, B, C certified, D spoiled, E discarded with its reason", async () => {
    const { result, world, codes } = await run();
    expect(result.statuses).toEqual({ A: "CERTIFIED", B: "CERTIFIED", C: "CERTIFIED", D: "SPOILED", E: "DISCARDED" });
    expect(result.reasons).toEqual({ E: REJECT_REASON });
    expect(result.fallback).toBeUndefined();
    // The stub's own state, not just what the script believes.
    expect((["A", "B", "C", "D", "E"] as const).map((l) => world.status(codes[l]))).toEqual([
      "CERTIFIED",
      "CERTIFIED",
      "CERTIFIED",
      "SPOILED",
      "DISCARDED",
    ]);
    expect(world.reason(codes.E)).toBe(REJECT_REASON);
  });

  test("the stream is started, one line per step, then finished", async () => {
    const { lines, seed } = await run();
    expect(lines.map((l) => (l.type === "step" ? `step:${l.id}:${l.ok}` : l.type))).toEqual([
      "started",
      "step:spoil-d:true",
      "step:precinct-tally:true",
      "step:election-night:true",
      "step:reject-e:true",
      "step:certify:true",
      "finished",
    ]);
    expect(lines[0]).toMatchObject({ type: "started", setId: seed.setId, deadline: 190 });
  });

  test("a slow step doesn't push later steps back", async () => {
    // Every batch takes 30 s: the 0:45 tally ends at 1:15, yet the 1:30 report still starts at 1:30.
    const { writes, seconds, lines, result } = await run({ delayMs: { createBatch: 30_000 } });
    expect(writes.map((w) => seconds(w.at))).toEqual([20, 45, 45, 90, 120, 160]);
    expect(steps(lines).map((s) => s.ranAt)).toEqual([20, 75, 120, 120, 190]);
    expect(result).toMatchObject({ ok: true, overran: false, finishedAt: 190 });
  });

  test("a late step runs at once, and finishing after 190 s is reported as overran", async () => {
    const { writes, seconds, result } = await run({ delayMs: { createBatch: 40_000 } });
    // The 1:30 batch ends at 2:10, so the 2:00 rejection runs straight away at 2:10.
    expect(writes.map((w) => [w.method, seconds(w.at)])).toEqual([
      ["uploadEventsFile", 20],
      ["uploadEventsFile", 45],
      ["createBatch", 45],
      ["createBatch", 90],
      ["resolveChallenge", 130],
      ["createBatch", 160],
    ]);
    expect(result).toMatchObject({ ok: true, overran: true, finishedAt: 200 });
  });
});

describe("real endpoints, same events, nothing rewritten (AC 4)", () => {
  test("E is challenged only by the fault in the precinct-close upload, and the 0:45 batch counts 3", async () => {
    const { calls, world, codes, eventsBefore } = await run();
    const events = world.events().slice(eventsBefore);
    const eChallenged = events.filter((e) => e.trackingCode === codes.E && e.to === "CHALLENGED");
    expect(eChallenged).toEqual([expect.objectContaining({ eventType: "MISMATCH_DETECTED", from: "CAST" })]);
    // The upload that challenged E was the precinct-close file with E as its only fault.
    const uploads = calls.filter((c) => c.method === "uploadEventsFile").map((c) => JSON.parse((c.args[0] as { body: string }).body));
    expect(uploads).toEqual([
      { kind: "spoil", setId: expect.any(String), trackingCode: codes.D },
      { kind: "precinct-close", setId: expect.any(String), faults: [codes.E] },
    ]);
    const firstBatch = events.filter((e) => e.batchId !== null && e.to === "TALLIED_PRECINCT");
    expect(firstBatch.map((e) => e.trackingCode).sort()).toEqual([codes.A, codes.B, codes.C].sort());
  });

  test("the 2:00 step finds E's challenge through listMismatches and rejects it with the reason", async () => {
    const { calls, codes } = await run();
    const i = calls.findIndex((c) => c.method === "resolveChallenge");
    const list = calls.slice(0, i).filter((c) => c.method === "listMismatches");
    expect(list).toHaveLength(1);
    expect(list[0]!.args[0]).toMatch(/^demo-[a-z2-7]{6}-c$/);
    expect(calls[i]!.args).toEqual([expect.stringMatching(/^challenge-/), { resolution: "rejected", reason: REJECT_REASON }]);
    expect(calls.filter((c) => c.method === "resolveChallenge")).toHaveLength(1);
    expect(codes.E).toBeTruthy();
  });

  test("batches go to the set's own precinct and county only", async () => {
    const { calls, check } = await run();
    expect(calls.filter((c) => c.method === "createBatch").map((c) => c.args[0])).toEqual([
      { scope: "precinct", scopeId: check.set.precinctId, from: "CAST", to: "TALLIED_PRECINCT" },
      { scope: "county", scopeId: check.set.countyId, from: "TALLIED_PRECINCT", to: "REPORTED_UNOFFICIAL" },
      { scope: "county", scopeId: check.set.countyId, from: "REPORTED_UNOFFICIAL", to: "CERTIFIED" },
    ]);
  });

  test("the event log only grows: every earlier snapshot is a prefix of the next", async () => {
    const { snapshots, world } = await run();
    const all = [...snapshots, world.events()];
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!.slice(0, all[i - 1]!.length)).toEqual(all[i - 1]);
    }
    expect(all.at(-1)!.length).toBeGreaterThan(all[0]!.length);
  });

  test("the API port has no update or delete method", async () => {
    const { world } = await run();
    const methods: (keyof ApiPort)[] = ["uploadEventsFile", "createBatch", "listMismatches", "resolveChallenge", "readTrack", "readSet"];
    expect(Object.keys(world.api).sort()).toEqual([...methods].sort());
    expect(Object.keys(world.api).filter((m) => /delete|update|remove|reset|put|patch/i.test(m))).toEqual([]);
  });

  test("a failed step stops the run: no further calls and no retries", async () => {
    const { lines, calls, result } = await run({ failOn: { method: "createBatch", status: 500, message: "boom" } });
    expect(steps(lines).map((s) => [s.id, s.ok])).toEqual([
      ["spoil-d", true],
      ["precinct-tally", false],
    ]);
    expect(steps(lines)[1]).toMatchObject({ error: "api", message: "boom" });
    expect(calls.filter((c) => c.method === "createBatch")).toHaveLength(1);
    expect(calls.at(-1)!.method).toBe("createBatch");
    expect(result).toMatchObject({ ok: false, overran: false });
  });

  test("no output line carries a tracking code, even when an error quotes one", async () => {
    const clock = fakeClock();
    const { world, seed } = await seededWorld(clock);
    const check = await checkSet(world.api, seed.setId);
    if (!check.ok) throw new Error(check.message);
    const lines: RunLine[] = [];
    const failing: ApiPort = {
      ...world.api,
      createBatch: async () => {
        throw new ApiError(409, `ballot ${check.set.codes.A} is not CAST`);
      },
    };
    await runTimeline({ api: failing, simulator: world.simulator, clock, set: check.set, onLine: (l) => lines.push(l) });
    const text = JSON.stringify(lines);
    for (const code of Object.values(check.set.codes)) expect(text).not.toContain(code);
    expect(text).toContain("ballot <A> is not CAST");

    const ok = await run();
    const okText = JSON.stringify(ok.lines);
    for (const code of Object.values(ok.codes)) expect(okText).not.toContain(code);
  });
});

describe("tracker within 3 seconds (AC 5)", () => {
  test("each step is ok only after GET /api/track shows the new status", async () => {
    const { calls, start } = await run();
    // After each write, the tracker is read before the step's line is emitted.
    for (const step of STEPS) {
      const at = start + step.at * 1000;
      const reads = calls.filter((c) => c.method === "readTrack" && c.at >= at && c.at <= at + READBACK_MS);
      expect(reads.length, step.id).toBeGreaterThan(0);
    }
  });

  test("a tracker that shows the change 0.5 s late still passes (well within 1 s + a 2 s poll)", async () => {
    const { result } = await run({ trackLagMs: 500 });
    expect(result.ok).toBe(true);
  });

  test("a 1.5 s read-back delay fails the step as tracker-lag", async () => {
    const { lines, result } = await run({ trackLagMs: 1_500 });
    expect(steps(lines)).toEqual([expect.objectContaining({ id: "spoil-d", ok: false, error: "tracker-lag" })]);
    expect(result.ok).toBe(false);
    expect(READBACK_MS).toBe(1_000);
  });
});

describe("one run per set (AC 7)", () => {
  test("a set that already ran is refused, with no writes", async () => {
    const { world, seed } = await run();
    const before = world.calls().length;
    const again = await checkSet(world.api, seed.setId);
    expect(again).toMatchObject({ ok: false, reason: "already-ran" });
    expect(world.calls().slice(before).map((c) => c.method)).toEqual(["readSet"]);
  });

  test("a set where any one ballot has left CAST is refused", async () => {
    const clock = fakeClock();
    const { world, seed } = await seededWorld(clock);
    const check = await checkSet(world.api, seed.setId);
    if (!check.ok) throw new Error(check.message);
    await world.api.uploadEventsFile(await world.simulator.spoilExport({ setId: seed.setId, trackingCode: check.set.codes.B }));
    expect(await checkSet(world.api, seed.setId)).toMatchObject({ ok: false, reason: "already-ran" });
  });

  test("a set without exactly 5 ballots is refused", async () => {
    const { world } = await seededWorld(fakeClock());
    expect(await checkSet(world.api, "demo-zzzzzz")).toMatchObject({ ok: false, reason: "wrong-count" });
  });

  test("two runs started together: the second fails at the spoil and writes nothing", async () => {
    const clock = fakeClock();
    const { world, seed } = await seededWorld(clock);
    const [one, two] = [await checkSet(world.api, seed.setId), await checkSet(world.api, seed.setId)];
    if (!one.ok || !two.ok) throw new Error("both checks pass before any step");
    const before = world.events().length;
    const results = await Promise.all([
      runTimeline({ api: world.api, simulator: world.simulator, clock, set: one.set }),
      runTimeline({ api: world.api, simulator: world.simulator, clock, set: two.set }),
    ]);
    expect(results.map((r) => r.ok).sort()).toEqual([false, true]);
    // Only the winning run's events: 1 spoil, 1 challenge, 3 + 3 + 3 batch moves, 1 discard.
    expect(world.events().length - before).toBe(1 + 1 + 3 + 3 + 3 + 1);
  });
});

describe("SPOILED fallback (AC 8)", () => {
  test("isUnsupportedSpoil matches only an unsupported-event refusal", () => {
    expect(isUnsupportedSpoil(new ApiError(422, "unsupported event type SPOILED"))).toBe(true);
    expect(isUnsupportedSpoil(new ApiError(501, "SPOILED events are not supported"))).toBe(true);
    expect(isUnsupportedSpoil(new ApiError(409, "INVALID_TRANSITION: Transition SPOILED -> SPOILED is not allowed"))).toBe(false);
    expect(isUnsupportedSpoil(new ApiError(500, "unsupported event type SPOILED"))).toBe(false);
    expect(isUnsupportedSpoil(new Error("unsupported event type SPOILED"))).toBe(false);
  });

  test("D is challenged and accepted instead, and all five end final or certified", async () => {
    const { result, lines, calls, writes, seconds, codes } = await run({ spoilUnsupported: true });
    expect(result.statuses).toEqual({ A: "CERTIFIED", B: "CERTIFIED", C: "CERTIFIED", D: "CERTIFIED", E: "DISCARDED" });
    expect(result.reasons).toEqual({ E: REJECT_REASON });
    expect(result.fallback).toBe("spoil-unsupported");
    expect(steps(lines)[0]).toMatchObject({ id: "spoil-d", ok: true, fallback: "spoil-unsupported" });
    expect(result.ok && !result.overran).toBe(true);
    // At 0:20: the refused spoil, D's mismatch upload, and D's challenge accepted, all before the tally.
    expect(writes.map((w) => [w.method, seconds(w.at)])).toEqual([
      ["uploadEventsFile", 20],
      ["uploadEventsFile", 20],
      ["resolveChallenge", 20],
      ["uploadEventsFile", 45],
      ["createBatch", 45],
      ["createBatch", 90],
      ["resolveChallenge", 120],
      ["createBatch", 160],
    ]);
    const accepted = calls.find((c) => c.method === "resolveChallenge")!;
    expect(accepted.args[1]).toEqual({ resolution: "accepted" });
    expect(codes.D).toBeTruthy();
  });
});
