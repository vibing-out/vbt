// The demo CLI.
//
//   demo seed [--base-url <url>] [--out <dir>] [--stub]
//   demo run --set <id> [--base-url <url>] [--stub]
//
// seed creates a fresh set and writes its receipts, paper ballot records and cover sheet to <out>/<set>/.
// run runs the 3-minute timeline on a set (the same runTimeline as Demo control) and prints each NDJSON
// line. --stub works entirely in memory on an instant clock and never touches a database or the network;
// with --stub, run first seeds an in-memory set, so --set is not needed.
//
// Env (names from .env.example; e.g. `node --env-file=../../.env.local bin/demo.ts ...`):
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   sign-in and reading public.ballot_public
//   DEMO_STATE_EMAIL, DEMO_STATE_PASSWORD, DEMO_STATE_TOTP_SECRET     the state official the steps run as (MFA)
//   SUPABASE_SECRET_KEY                                               seed only: inserts the precinct and machine
//   VERCEL_AUTOMATION_BYPASS_SECRET (optional)                       a protected preview

import { parseArgs } from "node:util";
import { fakeClock, realClock } from "./clock.ts";
import { httpPorts } from "./http-ports.ts";
import type { ApiPort, Clock, FileSink, ReceiptsPort, RegistryWriter, SimulatorPort } from "./ports.ts";
import { seedSet, TRACKER_BASE_URL } from "./seed.ts";
import { isSetId } from "./set-id.ts";
import { stubWorld } from "./stubs.ts";
import { checkSet, runTimeline, type RunLine } from "./timeline.ts";
import { demoAdapters } from "./unwired.ts";

export const USAGE = `Usage:
  demo seed [--base-url <url>] [--out <dir>] [--stub]
  demo run --set <id> [--base-url <url>] [--stub]`;

export type Env = Readonly<Record<string, string | undefined>>;

export type CliCommand =
  | { command: "seed"; baseUrl: string; out: string; stub: boolean }
  | { command: "run"; baseUrl: string; setId: string | null; stub: boolean };

/** Parses argv (without node and the script). Returns an error message for bad input. */
export function parseCliArgs(argv: readonly string[]): CliCommand | { error: string } {
  const [command, ...rest] = argv;
  let values: { "base-url"?: string; out?: string; set?: string; stub?: boolean };
  try {
    ({ values } = parseArgs({
      args: rest,
      strict: true,
      allowPositionals: false,
      options: { "base-url": { type: "string" }, out: { type: "string" }, set: { type: "string" }, stub: { type: "boolean" } },
    }));
  } catch (error) {
    return { error: (error as Error).message };
  }
  const baseUrl = values["base-url"] ?? TRACKER_BASE_URL;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
  } catch {
    return { error: `--base-url is not an http(s) URL: ${baseUrl}` };
  }
  const stub = values.stub ?? false;
  if (command === "seed") {
    if (values.set !== undefined) return { error: "seed takes no --set; it always creates a fresh set" };
    return { command, baseUrl, out: values.out ?? "out", stub };
  }
  if (command === "run") {
    if (values.out !== undefined) return { error: "run takes no --out" };
    if (!stub && values.set === undefined) return { error: "run needs --set <id>" };
    if (values.set !== undefined && !isSetId(values.set)) return { error: `not a demo set id: ${values.set}` };
    return { command, baseUrl, setId: values.set ?? null, stub };
  }
  return { error: command ? `unknown command: ${command}` : "no command" };
}

export interface Connected {
  api: ApiPort;
  registry: RegistryWriter;
}

export interface CliDeps {
  env: Env;
  out: (line: string) => void;
  err: (line: string) => void;
  /** The simulator and receipts adapters (unwired until the follow-up). */
  adapters?: () => { simulator: SimulatorPort; receipts: ReceiptsPort };
  /** Signs in and builds the real ports. Only called once the adapters are known to be wired. */
  connect?: (baseUrl: string, env: Env, needsRegistry: boolean) => Promise<Connected>;
  sink?: (dir: string) => FileSink;
  clock?: Clock;
}

const printLine = (out: (line: string) => void) => (line: RunLine) => out(JSON.stringify(line));

/** Runs one command. Resolves with the exit code: 0 ok, 1 failed or overran, 2 bad arguments, 3 refused. */
export async function main(argv: readonly string[], deps: CliDeps): Promise<number> {
  const parsed = parseCliArgs(argv);
  if ("error" in parsed) {
    deps.err(parsed.error);
    deps.err(USAGE);
    return 2;
  }

  try {
    if (parsed.stub) return await stubbed(parsed, deps);

    const { simulator, receipts } = (deps.adapters ?? demoAdapters)();
    if (!simulator.available || (parsed.command === "seed" && !receipts.available)) {
      deps.err("The simulator or receipts adapter is not wired yet (follow-up once T-06 and T-07 reach main). Nothing was written.");
      deps.err("Use --stub for an in-memory dry run.");
      return 1;
    }
    const { api, registry } = await (deps.connect ?? connect)(parsed.baseUrl, deps.env, parsed.command === "seed");

    if (parsed.command === "seed") {
      const result = await seedSet({ api, simulator, receipts, registry, sink: (deps.sink ?? nodeSink)(parsed.out), appBaseUrl: parsed.baseUrl });
      printSeed(result, parsed.out, deps.out);
      return 0;
    }

    const check = await checkSet(api, parsed.setId!);
    if (!check.ok) {
      deps.err(JSON.stringify({ type: "refused", reason: check.reason, message: check.message }));
      return 3;
    }
    const result = await runTimeline({ api, simulator, clock: deps.clock ?? realClock, set: check.set, onLine: printLine(deps.out) });
    return result.ok && !result.overran ? 0 : 1;
  } catch (error) {
    deps.err((error as Error).message);
    return 1;
  }
}

async function stubbed(parsed: CliCommand, deps: CliDeps): Promise<number> {
  const clock = deps.clock ?? fakeClock();
  const world = stubWorld(clock);
  const seeded = await seedSet({ ...world, appBaseUrl: parsed.baseUrl });
  if (parsed.command === "seed") {
    printSeed(seeded, "(in memory)", deps.out);
    return 0;
  }
  deps.err(`--stub: running in memory on a freshly seeded set ${seeded.setId}; nothing leaves this process.`);
  const check = await checkSet(world.api, seeded.setId);
  if (!check.ok) throw new Error(check.message);
  const result = await runTimeline({ api: world.api, simulator: world.simulator, clock, set: check.set, onLine: printLine(deps.out) });
  return result.ok && !result.overran ? 0 : 1;
}

function printSeed(result: Awaited<ReturnType<typeof seedSet>>, out: string, print: (line: string) => void) {
  print(`Seeded demo set ${result.setId} (precinct ${result.precinctId}, county ${result.countyId}).`);
  for (const b of result.ballots) print(`  ${b.label}  ${b.url}`);
  print(`Demo control: ${result.controlUrl}`);
  print(`Receipts, paper ballot records and the cover sheet: ${out}/${result.setId}/`);
}

function need(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const AUTH_OPTIONS = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/** Signs in as the demo state official with password and TOTP. Returns an aal2 access token. */
export async function signInAsDemoState(env: Env): Promise<string> {
  const { createClient } = await import("@supabase/supabase-js");
  const OTPAuth = await import("otpauth");
  const supabase = createClient(need(env, "NEXT_PUBLIC_SUPABASE_URL"), need(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), { auth: AUTH_OPTIONS });
  const signIn = await supabase.auth.signInWithPassword({ email: need(env, "DEMO_STATE_EMAIL"), password: need(env, "DEMO_STATE_PASSWORD") });
  if (signIn.error) throw new Error(`sign-in failed: ${signIn.error.message}`);
  const factors = await supabase.auth.mfa.listFactors();
  const factor = factors.data?.totp[0];
  if (factors.error || !factor) throw new Error("the demo state official has no verified TOTP factor");
  const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(need(env, "DEMO_STATE_TOTP_SECRET")) }).generate();
  const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (verified.error) throw new Error(`MFA failed: ${verified.error.message}`);
  return verified.data.access_token;
}

/** Signs in as the demo state official (aal2) and builds the real ports. */
export async function connect(baseUrl: string, env: Env, needsRegistry: boolean): Promise<Connected> {
  const { createClient } = await import("@supabase/supabase-js");
  const url = need(env, "NEXT_PUBLIC_SUPABASE_URL");
  const key = need(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const auth = AUTH_OPTIONS;

  const api = httpPorts({
    baseUrl,
    session: { authorization: `Bearer ${await signInAsDemoState(env)}` },
    ...(env.VERCEL_AUTOMATION_BYPASS_SECRET ? { bypassSecret: env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}),
    supabaseUrl: url,
    publishableKey: key,
  });

  let registry: RegistryWriter = {
    insertPrecinct: async () => {
      throw new Error("run never inserts");
    },
    insertMachine: async () => {
      throw new Error("run never inserts");
    },
  };
  if (needsRegistry) {
    const admin = createClient(url, need(env, "SUPABASE_SECRET_KEY"), { auth });
    const insert = async (table: "precincts" | "machines", row: Record<string, string>) => {
      const { error } = await admin.from(table).insert(row);
      if (error) throw new Error(`inserting into ${table} failed: ${error.message}`);
    };
    registry = { insertPrecinct: (row) => insert("precincts", row), insertMachine: (row) => insert("machines", row) };
  }
  return { api, registry };
}

export function nodeSink(dir: string): FileSink {
  return {
    async write(path, contents) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname, join } = await import("node:path");
      const file = join(dir, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, contents);
    },
  };
}
