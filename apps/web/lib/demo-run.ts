import "server-only";

import {
  ApiError,
  type ApiPort,
  checkSet,
  type Clock,
  httpPorts,
  realClock,
  type RunLine,
  runTimeline,
  type SimulatorPort,
  STEPS,
  unwiredSimulator,
} from "@vbt/demo";

// The body of POST /api/official/demo/runs (T-22), after the route's requireRole guard has passed. It
// calls the locked endpoints at this app's own origin with the caller's own session, so each endpoint runs
// its own role and MFA check and records the same official as the manual flow does. It streams the run as
// NDJSON (one RunLine per line) so Demo control can show each step while the 3-minute run is going.

export interface DemoRunDeps {
  readonly api: ApiPort;
  readonly simulator: SimulatorPort;
  readonly clock: Clock;
}

type Env = Readonly<Record<string, string | undefined>>;

/** The caller's session, forwarded as is: the bearer token when sent, otherwise the session cookies. */
function session(request: Request): Record<string, string> {
  const authorization = request.headers.get("authorization");
  if (authorization) return { authorization };
  const cookie = request.headers.get("cookie");
  return cookie ? { cookie } : {};
}

/** Builds the ports. An object, so tests can swap in the stubs. */
export const demoRunDeps = {
  make(request: Request, env: Env = process.env): DemoRunDeps {
    const bypassSecret = env.VERCEL_AUTOMATION_BYPASS_SECRET;
    return {
      api: httpPorts({
        baseUrl: new URL(request.url).origin,
        session: session(request),
        ...(bypassSecret ? { bypassSecret } : {}),
        supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
      }),
      // The real tools/simulator adapter is wired by a follow-up once epic/4 reaches main.
      simulator: unwiredSimulator(),
      clock: realClock,
    };
  },
};

const NO_STORE = { "cache-control": "no-store" };

const refuse = (status: number, error: string, message: string) =>
  Response.json({ error, message }, { status, headers: NO_STORE });

const WRITES = ["uploadEventsFile", "createBatch", "resolveChallenge"] as const;

/**
 * The API port, watched: counts the writes that succeeded and remembers whether one was refused as an
 * invalid transition. Two Starts on one set at the same moment both pass checkSet; the loser's first
 * write is then refused this way, before it has written anything.
 */
function watchWrites(api: ApiPort) {
  const state = { writes: 0, invalidTransition: false };
  const watched: ApiPort = { ...api };
  for (const method of WRITES) {
    const call = api[method].bind(api) as (...args: unknown[]) => Promise<never>;
    (watched as unknown as Record<string, unknown>)[method] = async (...args: unknown[]) => {
      try {
        const result = await call(...args);
        state.writes += 1;
        return result;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409 && /INVALID_TRANSITION/i.test(error.message)) {
          state.invalidTransition = true;
        }
        throw error;
      }
    };
  }
  return { api: watched, state };
}

/**
 * Checks the set, then streams its one run. 409 when the set has already run or isn't a 5-ballot set,
 * and also when another Start on the same set won the race: its first step is refused as an invalid
 * transition before this run has written anything (ticket AC 7). Every other failure keeps the stream.
 * So the response waits for the first step's outcome; the lines before it are sent together then.
 */
export async function startDemoRun(request: Request, setId: string): Promise<Response> {
  const deps = demoRunDeps.make(request);
  if (!deps.simulator.available) {
    return refuse(503, "demo-unavailable", "The simulator adapter is not wired yet; nothing was written.");
  }

  let check: Awaited<ReturnType<typeof checkSet>>;
  try {
    check = await checkSet(deps.api, setId);
  } catch {
    return refuse(502, "set-unreadable", "Could not read the demo set.");
  }
  if (!check.ok) return refuse(409, check.reason, check.message);
  const set = check.set;

  const watched = watchWrites(deps.api);
  const held: RunLine[] = [];
  let sink: ((line: RunLine) => void) | null = null;
  let decide: (lostRace: boolean) => void = () => {};
  const decided = new Promise<boolean>((resolve) => {
    decide = resolve;
  });
  const lostRace = (line: RunLine) =>
    line.type === "step" &&
    !line.ok &&
    line.id === STEPS[0]!.id &&
    line.error === "api" &&
    watched.state.invalidTransition &&
    watched.state.writes === 0;

  const done = runTimeline({
    api: watched.api,
    simulator: deps.simulator,
    clock: deps.clock,
    set,
    onLine: (line) => {
      if (sink) return sink(line);
      held.push(line);
      if (line.type === "step" || line.type === "finished") decide(lostRace(line));
    },
  }).finally(() => decide(false));

  if (await decided) {
    void done.catch(() => {});
    return refuse(409, "already-ran", `set ${setId} is already running or has run; seed a fresh set for each rehearsal`);
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      // A closed tab stops the stream, not the run: the steps keep going while this function lives.
      const send = (line: RunLine) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {
          open = false;
        }
      };
      for (const line of held.splice(0)) send(line);
      sink = send;
      await done;
      if (open) controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson", ...NO_STORE } });
}
