// pnpm --filter @vbt/scale-demo seed [--ballots 10000] [--precincts 20] [--rate 0.005] [--seed <s>] [--yes]
//
// Without --yes: a dry run that prints the plan's counts and touches neither crypto nor a database.
// With --yes: builds through the crypto adapter and writes to PRODUCT_DATABASE_URL in one transaction.
// Output is counts per precinct and the elapsed run time only: no tracking codes, ids or event times.
// Refuses to run under CI. Exits 1 when the run takes longer than RUN_BUDGET_MS.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { PrecinctSummary } from "./build.ts";
import { buildPlan, DEFAULT_SEED, FULL_RUN, type PlanOptions } from "./plan.ts";
import { type RunSeedDeps, runSeed } from "./write.ts";

/** Ticket T-11: the run finishes in under 2 minutes. */
export const RUN_BUDGET_MS = 120_000;

export interface CliDeps extends RunSeedDeps {
  env: Readonly<Record<string, string | undefined>>;
  /** Milliseconds, monotonic. */
  now?: () => number;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

export function parseOptions(argv: readonly string[]): { options: PlanOptions; yes: boolean } {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      ballots: { type: "string" },
      precincts: { type: "string" },
      rate: { type: "string" },
      seed: { type: "string" },
      yes: { type: "boolean", default: false },
    },
  });
  const num = (value: string | undefined, fallback: number, name: string) => {
    if (value === undefined) return fallback;
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) throw new RangeError(`--${name} must be a number`);
    return n;
  };
  return {
    options: {
      ballots: num(values.ballots, FULL_RUN.ballots, "ballots"),
      precincts: num(values.precincts, FULL_RUN.precincts, "precincts"),
      rate: num(values.rate, FULL_RUN.rate, "rate"),
      seed: values.seed ?? DEFAULT_SEED,
    },
    yes: values.yes === true,
  };
}

function printSummary(out: (line: string) => void, summary: readonly PrecinctSummary[]): void {
  for (const s of summary) out(`${s.precinct_id}  ballots ${s.ballots}  tallied ${s.tallied}  challenged ${s.challenged}`);
  const sum = (key: "ballots" | "tallied" | "challenged") => summary.reduce((n, s) => n + s[key], 0);
  out(`total  ballots ${sum("ballots")}  tallied ${sum("tallied")}  challenged ${sum("challenged")}`);
}

export async function main(argv: readonly string[], deps: CliDeps): Promise<number> {
  const out = deps.out ?? ((line) => console.log(line));
  const err = deps.err ?? ((line) => console.error(line));
  const now = deps.now ?? (() => performance.now());
  const started = now();
  try {
    if (deps.env.CI) {
      err("scale-demo: refusing to seed under CI (it writes insert-only rows to the product database)");
      return 1;
    }
    const { options, yes } = parseOptions(argv);
    if (!yes) {
      const plan = buildPlan(options);
      const summary = plan.precincts.map((p) => {
        const inPrecinct = plan.ballots.filter((b) => b.precinctId === p.id);
        const challenged = inPrecinct.filter((b) => b.mismatch).length;
        return { precinct_id: p.id, ballots: inPrecinct.length, tallied: inPrecinct.length - challenged, challenged };
      });
      out(`scale-demo dry run (pass --yes to write): county ${plan.countyId}, seed ${options.seed}`);
      printSummary(out, summary);
      return 0;
    }
    const databaseUrl = deps.env.PRODUCT_DATABASE_URL ?? "";
    const rows = await runSeed({ databaseUrl, options, env: deps.env }, deps);
    printSummary(out, rows.summary);
  } catch (error) {
    err(`scale-demo: ${(error as Error).message}`);
    return 1;
  }
  const seconds = (now() - started) / 1000;
  if (seconds * 1000 > RUN_BUDGET_MS) {
    err(`scale-demo: the run took ${seconds.toFixed(1)} s, over the ${RUN_BUDGET_MS / 1000} s budget`);
    return 1;
  }
  out(`elapsed ${seconds.toFixed(1)} s (budget ${RUN_BUDGET_MS / 1000} s)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // PRODUCT_DATABASE_URL and the keys may live in the repo's .env.local; variables already set win.
  const envLocal = new URL("../../../.env.local", import.meta.url);
  if (existsSync(envLocal)) process.loadEnvFile(envLocal);
  process.exitCode = await main(process.argv.slice(2), { env: process.env });
}
