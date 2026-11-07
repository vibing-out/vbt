#!/usr/bin/env node
// `vbt-verify`: check the published election record without trusting our
// servers. main() returns the exit code and never calls process.exit:
// 0 every check passed, 1 at least one check failed, 2 usage, network or
// format error (nothing verified).

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { checkChain } from "./checks/chain.ts";
import { checkInclusion } from "./checks/inclusion.ts";
import { checkBallotCount, checkLeafOrder, checkMerkleRoot } from "./checks/merkle.ts";
import { checkSignature } from "./checks/signature.ts";
import { checkC2, checkC3, checkC4 } from "./checks/totals.ts";
import { type CryptoAdapter, CryptoUnavailableError, realCrypto } from "./crypto.ts";
import { COUNTY_STAGES, PRECINCT_STAGES, type PublishedRecord, SCOPE_ID, type Stage } from "./record.ts";
import { type Check, EXIT, exitCode, formatJson, formatText, skip } from "./report.ts";
import { dirSource, download, type FetchLike, getRecord, getTrack, httpSource, parseBaseUrl, type Source, VerifyError } from "./source.ts";

export const USAGE = `Usage:
  vbt-verify record   --base-url <url> --county <id> --precinct <id>... [--public-key <b64>] [--json]
  vbt-verify code     <tracking-code> --base-url <url> [--public-key <b64>] [--json]
  vbt-verify download --base-url <url> --county <id> --precinct <id>... --out <dir>
  vbt-verify record|code ... --from-dir <dir>      # offline, in place of --base-url

--public-key is the stage signing public key (base64). It can also come from
STAGE_SIGNING_PUBLIC_KEY. Get it from the election office, never from the
server you are checking. With no key the run fails.

Exit codes: 0 every check passed, 1 a check failed, 2 could not verify.
`;

export type Deps = {
  crypto: CryptoAdapter;
  fetch: FetchLike;
  env: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
};

const defaultDeps = (): Deps => ({
  crypto: realCrypto,
  fetch: (url, init) => globalThis.fetch(url, init),
  env: process.env,
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
});

const usage = (reason: string) => new VerifyError("usage", reason);

type Options = {
  "base-url"?: string;
  "from-dir"?: string;
  county?: string;
  precinct?: string[];
  "public-key"?: string;
  json?: boolean;
  out?: string;
  help?: boolean;
};

function parse(argv: readonly string[]): { command?: string; positionals: string[]; options: Options } {
  try {
    const { values, positionals } = parseArgs({
      args: argv[0] === "--" ? argv.slice(1) : [...argv],
      strict: true,
      allowPositionals: true,
      options: {
        "base-url": { type: "string" },
        "from-dir": { type: "string" },
        county: { type: "string" },
        precinct: { type: "string", multiple: true },
        "public-key": { type: "string" },
        json: { type: "boolean" },
        out: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    const [command, ...rest] = positionals;
    return { command, positionals: rest, options: values };
  } catch (err) {
    throw usage((err as Error).message);
  }
}

function reject(o: Options, command: string, flags: (keyof Options)[]): void {
  for (const f of flags) if (o[f] !== undefined) throw usage(`--${f} is not an option of ${command}`);
}

/** Base64 Ed25519 public key (32 bytes), from --public-key or STAGE_SIGNING_PUBLIC_KEY. null when neither is set. */
function publicKey(o: Options, env: Deps["env"]): Uint8Array | null {
  const raw = (o["public-key"] ?? env.STAGE_SIGNING_PUBLIC_KEY ?? "").trim();
  if (raw === "") return null;
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32 || bytes.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
    throw usage("the stage signing public key must be base64 of 32 bytes");
  }
  return new Uint8Array(bytes);
}

function source(o: Options, deps: Deps): Source {
  const url = o["base-url"];
  const dir = o["from-dir"];
  if (url !== undefined && dir !== undefined) throw usage("use --base-url or --from-dir, not both");
  if (dir !== undefined) return dirSource(dir);
  if (url === undefined) throw usage("give --base-url <url> or --from-dir <dir>");
  return httpSource(parseBaseUrl(url), deps.fetch);
}

type Scopes = { county: string; precincts: string[] };

function scopes(o: Options): Scopes {
  if (!o.county) throw usage("--county <id> is required");
  if (!o.precinct?.length) throw usage("at least one --precinct <id> is required");
  for (const id of [o.county, ...o.precinct]) if (!SCOPE_ID.test(id)) throw usage(`${id} is not a valid scope id`);
  if (new Set(o.precinct).size !== o.precinct.length) throw usage("a precinct is listed twice");
  return { county: o.county, precincts: o.precinct };
}

function wanted(s: Scopes): { scopeId: string; stage: Stage }[] {
  return [
    ...s.precincts.flatMap((p) => PRECINCT_STAGES.map((stage) => ({ scopeId: p, stage }))),
    ...COUNTY_STAGES.map((stage) => ({ scopeId: s.county, stage })),
  ];
}

const notPublished = (scopeId: string, stage: Stage): Check => skip("published", scopeId, stage, "not published");
const needs = (scopeId: string, stage: Stage) => `needs ${scopeId}/${stage}, not published`;

async function recordChecks(r: PublishedRecord, deps: Deps, key: Uint8Array | null): Promise<Check[]> {
  return [await checkSignature(deps.crypto, r, key), checkMerkleRoot(deps.crypto, r), checkLeafOrder(r), checkBallotCount(r)];
}

async function runRecord(o: Options, deps: Deps): Promise<Check[]> {
  reject(o, "record", ["out"]);
  const key = publicKey(o, deps.env);
  const s = scopes(o);
  const src = source(o, deps);
  await deps.crypto.ready();

  const records = new Map<string, PublishedRecord | null>();
  const at = (scopeId: string, stage: Stage) => records.get(`${scopeId}/${stage}`) ?? null;
  const checks: Check[] = [];
  for (const w of wanted(s)) {
    const { record } = await getRecord(src, w.scopeId, w.stage);
    records.set(`${w.scopeId}/${w.stage}`, record);
    checks.push(...(record ? await recordChecks(record, deps, key) : [notPublished(w.scopeId, w.stage)]));
  }

  const precincts = s.precincts.map((p) => at(p, "TALLIED_PRECINCT"));
  s.precincts.forEach((p, i) => {
    const r = precincts[i];
    checks.push(...(r ? checkC2(r) : [skip("c2", p, "TALLIED_PRECINCT", needs(p, "TALLIED_PRECINCT"))]));
  });

  const unofficial = at(s.county, "REPORTED_UNOFFICIAL");
  const missingPrecinct = s.precincts.find((_, i) => !precincts[i]);
  if (missingPrecinct !== undefined) {
    checks.push(skip("c3", s.county, "REPORTED_UNOFFICIAL", needs(missingPrecinct, "TALLIED_PRECINCT")));
  } else if (!unofficial) {
    checks.push(skip("c3", s.county, "REPORTED_UNOFFICIAL", needs(s.county, "REPORTED_UNOFFICIAL")));
  } else {
    checks.push(...checkC3(precincts as PublishedRecord[], unofficial));
  }

  const certified = at(s.county, "CERTIFIED");
  if (!unofficial) checks.push(skip("c4", s.county, "CERTIFIED", needs(s.county, "REPORTED_UNOFFICIAL")));
  else if (!certified) checks.push(skip("c4", s.county, "CERTIFIED", needs(s.county, "CERTIFIED")));
  else checks.push(...checkC4(unofficial, certified, at(s.county, "CHALLENGED"), at(s.county, "DISCARDED")));
  return checks;
}

async function runCode(positionals: string[], o: Options, deps: Deps): Promise<Check[]> {
  reject(o, "code", ["out", "county", "precinct"]);
  if (positionals.length !== 1) throw usage("code takes exactly one tracking code");
  const key = publicKey(o, deps.env);
  const src = source(o, deps);
  await deps.crypto.ready();
  const code = (positionals[0] as string).trim().toUpperCase();
  if (!deps.crypto.isTrackingCode(code)) throw usage("that is not a tracking code (the format is WORD-WORD-XXXX-WORD)");

  const track = await getTrack(src, code);
  const checks = checkChain(code, track);
  for (const proof of track.proofs) {
    const { record } = await getRecord(src, proof.scope_id, proof.stage);
    if (!record) {
      checks.push(notPublished(proof.scope_id, proof.stage), skip("inclusion", code, proof.stage, needs(proof.scope_id, proof.stage)));
      continue;
    }
    checks.push(await checkSignature(deps.crypto, record, key), ...checkInclusion(deps.crypto, code, track, proof, record));
  }
  return checks;
}

async function runDownload(positionals: string[], o: Options, deps: Deps): Promise<number> {
  reject(o, "download", ["from-dir", "public-key", "json"]);
  if (positionals.length > 0) throw usage("download takes no positional arguments");
  if (o["base-url"] === undefined) throw usage("--base-url <url> is required for download");
  if (!o.out) throw usage("--out <dir> is required for download");
  const s = scopes(o);
  const result = await download(source(o, deps), o.out, wanted(s));
  const lines = [
    ...result.saved.map((w) => `SAVED ${w.scopeId}/${w.stage}`),
    ...result.notPublished.map((w) => `SKIP ${w.scopeId}/${w.stage}: not published`),
    `Saved ${result.saved.length} records to ${o.out}. Check them with: vbt-verify record --from-dir ${o.out} --county ...`,
  ];
  deps.out(`${lines.join("\n")}\n`);
  return EXIT.PASS;
}

async function run(argv: readonly string[], deps: Deps): Promise<number> {
  const { command, positionals, options } = parse(argv);
  if (options.help || command === "help") {
    deps.out(USAGE);
    return EXIT.PASS;
  }
  let checks: Check[];
  if (command === "record") {
    if (positionals.length > 0) throw usage("record takes no positional arguments");
    checks = await runRecord(options, deps);
  } else if (command === "code") {
    checks = await runCode(positionals, options, deps);
  } else if (command === "download") {
    return runDownload(positionals, options, deps);
  } else {
    throw usage(command === undefined ? "give a command: record, code or download" : `unknown command ${command}`);
  }
  deps.out(options.json ? formatJson(checks) : formatText(checks));
  return exitCode(checks);
}

export async function main(argv: readonly string[], overrides: Partial<Deps> = {}): Promise<number> {
  const deps = { ...defaultDeps(), ...overrides };
  try {
    return await run(argv, deps);
  } catch (err) {
    if (err instanceof VerifyError) {
      deps.err(`${err.line}\n${err.line.startsWith("ERROR usage") ? 'Run "vbt-verify --help" for usage.\n' : ""}`);
    } else if (err instanceof CryptoUnavailableError) {
      deps.err(`ERROR crypto: ${err.message}\n`);
    } else {
      deps.err(`ERROR: unexpected error (${err instanceof Error ? err.name : "unknown"})\n`);
    }
    return EXIT.COULD_NOT_VERIFY;
  }
}

function isEntry(): boolean {
  const script = process.argv[1];
  if (script === undefined) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) process.exitCode = await main(process.argv.slice(2));
