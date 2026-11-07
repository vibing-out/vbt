import "server-only";

import {
  type ApiPort,
  checkSet,
  type Clock,
  httpPorts,
  realClock,
  type RunLine,
  runTimeline,
  type SimulatorPort,
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

/** Checks the set, then streams its one run. 409 when the set has already run or isn't a 5-ballot set. */
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
      await runTimeline({ api: deps.api, simulator: deps.simulator, clock: deps.clock, set, onLine: send });
      if (open) controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson", ...NO_STORE } });
}
