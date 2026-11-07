#!/usr/bin/env node
// vbt-verify: checks one county's saved stage records (docs/record-format.md §10).
//
//   vbt-verify [--public-key <base64>] [--json] <record.json>...
//
// The key is the stage signing public key from the election office, never from the server being
// checked; it can also come from STAGE_SIGNING_PUBLIC_KEY. Exit 0 every check passed, 1 a check
// failed, 2 usage or format error (nothing verified).

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { FormatError, type PublishedRecord, parseRecord } from "./record.ts";
import { type CountyRecords, verifyCounty } from "./verify.ts";

export const USAGE = "usage: vbt-verify [--public-key <base64>] [--json] <record.json>...";

type Io = { out: (line: string) => void; err: (line: string) => void; env: Readonly<Record<string, string | undefined>> };

/** Decodes a 32-byte base64 key, or null. */
export function decodeKey(value: string | undefined): Uint8Array | null | "invalid" {
  if (value === undefined || value.trim() === "") return null;
  const v = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return "invalid";
  const bytes = new Uint8Array(Buffer.from(v, "base64"));
  return bytes.length === 32 ? bytes : "invalid";
}

/** Sorts records into one county. Throws a usage message for anything that is not one county. */
export function groupCounty(records: readonly PublishedRecord[]): CountyRecords {
  const county: CountyRecords & { precincts: PublishedRecord[] } = { precincts: [] };
  const key = { REPORTED_UNOFFICIAL: "unofficial", CERTIFIED: "certified", CHALLENGED: "challenged", DISCARDED: "discarded" } as const;
  let countyId: string | null = null;
  for (const r of records) {
    if (r.stage === "TALLIED_PRECINCT") {
      county.precincts.push(r);
      continue;
    }
    if (countyId !== null && countyId !== r.scope_id) throw new Error("county records name more than one county");
    countyId = r.scope_id;
    const slot = key[r.stage];
    if (county[slot]) throw new Error(`more than one ${r.stage} record`);
    county[slot] = r;
  }
  return county;
}

export async function main(argv: readonly string[], io: Io): Promise<number> {
  let keyArg: string | undefined;
  let json = false;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--public-key") keyArg = argv[++i];
    else if (a === "--json") json = true;
    else if (a.startsWith("--")) {
      io.err(USAGE);
      return 2;
    } else files.push(a);
  }
  if (files.length === 0) {
    io.err(USAGE);
    return 2;
  }
  const publicKey = decodeKey(keyArg ?? io.env.STAGE_SIGNING_PUBLIC_KEY);
  if (publicKey === "invalid") {
    io.err("ERROR --public-key: not a 32-byte base64 Ed25519 public key");
    return 2;
  }

  const records: PublishedRecord[] = [];
  for (const file of files) {
    try {
      records.push(parseRecord(JSON.parse(await readFile(file, "utf8"))));
    } catch (error) {
      const why = error instanceof FormatError ? `not a stage record (${error.message})` : "could not read JSON";
      io.err(`ERROR ${file}: ${why}`);
      return 2;
    }
  }
  let county: CountyRecords;
  try {
    county = groupCounty(records);
  } catch (error) {
    io.err(`ERROR ${(error as Error).message}`);
    return 2;
  }

  const { checks, ok } = await verifyCounty(county, publicKey);
  if (json) {
    io.out(JSON.stringify({ checks, passed: ok }));
  } else {
    for (const c of checks) {
      const where = `${c.scope_id}/${c.stage}`;
      if (c.ok) io.out(`PASS ${c.check} ${where}`);
      else for (const f of c.failures) io.out(`FAIL ${c.check} ${where}: ${f}`);
    }
    io.out(`${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
  }
  return ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2), {
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    env: process.env,
  });
}
