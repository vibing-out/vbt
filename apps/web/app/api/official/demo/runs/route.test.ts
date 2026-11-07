import type { RunLine } from "@vbt/demo";
import { fakeClock, seededWorld } from "@vbt/demo/testing";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { demoRunDeps } from "../../../../../lib/demo-run";
import { aal2, accessToken, ENV, fakeSupabase, GRANTS, USERS } from "../../../../../lib/testing/fake-supabase";
import * as route from "./route";

// The route with the real requireRole against the fake Supabase project (signed JWTs, RLS-like reads),
// and the demo ports swapped for the in-memory stubs on a fake clock, so a whole run takes milliseconds.

const call = (query: string, headers: Record<string, string> = {}) =>
  route.POST(new Request(`https://vbt.example/api/official/demo/runs${query}`, { method: "POST", headers }));
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** The fake project plus this test's demo precincts, so requireRole can find each set's county. */
function supabaseWith(demoCounties: string[], grants: Record<string, unknown> = GRANTS) {
  const fake = fakeSupabase({ rolesRows: (sub) => (grants[sub] ? [grants[sub]] : []) });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(new Request(input, init).url);
    const county = url.searchParams.get("county_id")?.replace(/^eq\./, "");
    if (url.pathname === "/rest/v1/precincts" && county && demoCounties.includes(county)) {
      return Response.json([{ county_id: county }]);
    }
    return fake.fetch(input, init);
  }) as typeof fetch;
  return fetchImpl;
}

async function readLines(response: Response): Promise<RunLine[]> {
  return (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RunLine);
}

let world: Awaited<ReturnType<typeof seededWorld>>["world"];
let setId: string;

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV.NEXT_PUBLIC_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const clock = fakeClock();
  const seeded = await seededWorld(clock);
  world = seeded.world;
  setId = seeded.seed.setId;
  vi.spyOn(demoRunDeps, "make").mockReturnValue({ api: world.api, simulator: world.simulator, clock });
  vi.stubGlobal("fetch", supabaseWith([`${setId}-c`]));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("who may start a run (AC 6: official tools, MFA)", () => {
  test("route settings: Node runtime, maxDuration 240 s", () => {
    expect(route.maxDuration).toBe(240);
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
  });

  test("403 with no session, a garbage token, aal1, a poll worker, or a county official of another county", async () => {
    const otherCounty = await aal2(USERS.county); // scoped to 18097
    for (const headers of [
      {},
      bearer("x"),
      bearer(await accessToken({ sub: USERS.state, aal: "aal1" })),
      bearer(await aal2(USERS.pollWorker)),
      bearer(otherCounty),
      bearer(await aal2(USERS.noGrant)),
    ]) {
      const response = await call(`?set=${setId}`, headers);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    expect(demoRunDeps.make).not.toHaveBeenCalled();
    expect(world.events().filter((e) => e.eventType !== "CAST")).toEqual([]);
  });

  test("a malformed or missing set id is refused before anything else", async () => {
    const token = await aal2(USERS.state);
    for (const query of ["", "?set=18097", "?set=demo-abc", `?set=${setId}&set=${setId}`]) {
      expect((await call(query, bearer(token))).status, query).toBe(403);
    }
    expect(demoRunDeps.make).not.toHaveBeenCalled();
  });

  test("a set nobody seeded is refused even for the state official (unknown county)", async () => {
    expect((await call("?set=demo-zzzzzz", bearer(await aal2(USERS.state)))).status).toBe(403);
  });

  test("the state official starts a run and gets the NDJSON stream: started, one line per step, finished", async () => {
    const response = await call(`?set=${setId}`, bearer(await aal2(USERS.state)));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const lines = await readLines(response);
    expect(lines.map((l) => (l.type === "step" ? l.id : l.type))).toEqual([
      "started",
      "spoil-d",
      "precinct-tally",
      "election-night",
      "reject-e",
      "certify",
      "finished",
    ]);
    expect(lines.at(-1)).toMatchObject({
      ok: true,
      overran: false,
      statuses: { A: "CERTIFIED", B: "CERTIFIED", C: "CERTIFIED", D: "SPOILED", E: "DISCARDED" },
      reasons: { E: "machine record did not match the paper ballot" },
    });
  });

  test("a county official scoped to the set's own county may start it", async () => {
    vi.stubGlobal("fetch", supabaseWith([`${setId}-c`], { ...GRANTS, [USERS.county]: { role: "county", scope: "county", scope_id: `${setId}-c` } }));
    const response = await call(`?set=${setId}`, bearer(await aal2(USERS.county)));
    expect(response.status).toBe(200);
    expect((await readLines(response)).at(-1)).toMatchObject({ type: "finished", ok: true });
  });

  test("the caller's session is what the demo ports forward", async () => {
    const token = await aal2(USERS.state);
    await (await call(`?set=${setId}`, bearer(token))).text();
    const request = vi.mocked(demoRunDeps.make).mock.calls[0]![0];
    expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
  });
});

describe("one run per set (AC 7)", () => {
  test("a second run on the same set gets 409 and writes nothing", async () => {
    const token = await aal2(USERS.state);
    await (await call(`?set=${setId}`, bearer(token))).text();
    const events = world.events().length;
    const second = await call(`?set=${setId}`, bearer(token));
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "already-ran" });
    expect(world.events().length).toBe(events);
  });

  test("two Starts at the same moment: one streams the run, the other gets 409 and writes nothing", async () => {
    // Both checks read the set before either run writes, so both pass checkSet.
    let arrived = 0;
    let release: () => void = () => {};
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = {
      ...world.api,
      readSet: async (precinctId: string) => {
        const ballots = await world.api.readSet(precinctId);
        if (++arrived === 2) release();
        await bothRead;
        return ballots;
      },
    };
    const clock = fakeClock();
    vi.mocked(demoRunDeps.make).mockReturnValue({ api, simulator: world.simulator, clock });
    const before = world.events().length;
    const token = await aal2(USERS.state);
    const responses = await Promise.all([call(`?set=${setId}`, bearer(token)), call(`?set=${setId}`, bearer(token))]);
    expect(arrived).toBe(2);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = responses.find((r) => r.status === 200)!;
    const loser = responses.find((r) => r.status === 409)!;
    expect(loser.headers.get("cache-control")).toBe("no-store");
    expect(await loser.json()).toMatchObject({ error: "already-ran" });
    expect((await readLines(winner)).at(-1)).toMatchObject({ type: "finished", ok: true });
    // Only the winning run's events: 1 spoil, 1 challenge, 3 + 3 + 3 batch moves, 1 discard.
    expect(world.events().length - before).toBe(1 + 1 + 3 + 3 + 3 + 1);
  });

  test("any other first-step failure keeps the 200 stream, with the failed step and the finish", async () => {
    const clock = fakeClock();
    const failing = await seededWorld(clock, { failOn: { method: "uploadEventsFile", status: 500, message: "upstream broke", nth: 2 } });
    vi.mocked(demoRunDeps.make).mockReturnValue({ api: failing.world.api, simulator: failing.world.simulator, clock });
    const response = await call(`?set=${failing.seed.setId}`, bearer(await aal2(USERS.state)));
    expect(response.status).toBe(200);
    const lines = await readLines(response);
    expect(lines.map((l) => (l.type === "step" ? l.id : l.type))).toEqual(["started", "spoil-d", "finished"]);
    expect(lines[1]).toMatchObject({ ok: false, error: "api" });
  });

  test("a set without exactly 5 ballots gets 409", async () => {
    const other = await seededWorld(fakeClock());
    vi.mocked(demoRunDeps.make).mockReturnValue({ api: { ...other.world.api, readSet: async () => [] }, simulator: world.simulator, clock: fakeClock() });
    const response = await call(`?set=${setId}`, bearer(await aal2(USERS.state)));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "wrong-count" });
  });

  test("without the real simulator adapter the route answers 503 and writes nothing", async () => {
    vi.mocked(demoRunDeps.make).mockRestore();
    const response = await call(`?set=${setId}`, bearer(await aal2(USERS.state)));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "demo-unavailable" });
    expect(world.events().filter((e) => e.eventType !== "CAST")).toEqual([]);
  });
});
