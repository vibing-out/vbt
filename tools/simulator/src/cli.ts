// `simulate` command line. main() returns the exit code; it never calls process.exit.

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULTS, simulate } from "./generate.ts";
import type { SimulateOptions } from "./types.ts";
import { writeOutput } from "./write.ts";

export const USAGE = `simulate [options]

Writes VotingWorks-shaped CDF machine logs, NIST SP 1500-103 cast vote
records, totals and a run manifest as files. No network or database calls.

Options:
  --ballots <n>          Number of cast ballots (integer ≥ 1). Required.
  --mismatch-rate <r>    Fraction in [0, 1]. Default 0. Fault count = round(n * r).
  --seed <s>             String or integer seed. Default "0".
  --out <dir>            Output directory (created if missing). Required.
  --machines <n>         Optional. Default 4. Must be ≥ 1.
  --precincts <n>        Optional. Default 2. Must be ≥ 1.
  --help                 Print usage.
`;

export class UsageError extends Error {}

export interface ParsedArgs {
  help: boolean;
  options?: SimulateOptions;
  out?: string;
}

function intArg(name: string, raw: string | undefined, fallback?: number): number {
  if (raw === undefined) {
    if (fallback === undefined) throw new UsageError(`--${name} is required`);
    return fallback;
  }
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new UsageError(`--${name} must be an integer ≥ 1, got "${raw}"`);
  return Number(raw);
}

export function parseCliArgs(argv: readonly string[]): ParsedArgs {
  // `pnpm exec simulate -- --ballots ...` can pass a leading "--" through.
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        ballots: { type: "string" },
        "mismatch-rate": { type: "string" },
        seed: { type: "string" },
        out: { type: "string" },
        machines: { type: "string" },
        precincts: { type: "string" },
        help: { type: "boolean" },
      },
    }));
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
  if (values.help) return { help: true };

  const str = (k: string): string | undefined => values[k] as string | undefined;
  const out = str("out");
  if (out === undefined || out === "") throw new UsageError("--out <dir> is required");

  const ballots = intArg("ballots", str("ballots"));
  const rateRaw = str("mismatch-rate");
  const mismatchRate = rateRaw === undefined ? DEFAULTS.mismatchRate : Number(rateRaw);
  if (rateRaw !== undefined && (rateRaw.trim() === "" || !(mismatchRate >= 0 && mismatchRate <= 1))) {
    throw new UsageError(`--mismatch-rate must be a number in [0, 1], got "${rateRaw}"`);
  }

  return {
    help: false,
    out,
    options: {
      ballots,
      mismatchRate,
      seed: str("seed") ?? DEFAULTS.seed,
      machines: intArg("machines", str("machines"), DEFAULTS.machines),
      precincts: intArg("precincts", str("precincts"), DEFAULTS.precincts),
    },
  };
}

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

const processIo: Io = {
  stdout: (s) => void process.stdout.write(s),
  stderr: (s) => void process.stderr.write(s),
};

export async function main(argv: readonly string[], io: Io = processIo): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.stderr(`simulate: error: ${err.message}\nRun "simulate --help" for usage.\n`);
    return 2;
  }
  if (parsed.help || !parsed.options || !parsed.out) {
    io.stdout(USAGE);
    return 0;
  }
  try {
    const out = resolve(parsed.out);
    const result = simulate(parsed.options);
    await writeOutput(out, result);
    const { manifest } = result;
    io.stdout(`wrote ${manifest.ballots} ballots, ${manifest.machines.length} machines, ${manifest.faultCount} faults → ${out}\n`);
    return 0;
  } catch (err) {
    io.stderr(`simulate: error: ${(err as Error).message}\n`);
    return 1;
  }
}
