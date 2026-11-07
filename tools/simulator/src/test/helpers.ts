// Test helpers: read an output tree and run the C1–C4 checks against it.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { castBallotIds } from "../formats/cdf-log.ts";
import { sameCounts, sumTotals, tallyCvrs, totalsPath } from "../formats/totals.ts";
import type { CdfLogFile, CheckId, CvrFile, Manifest, TotalsFile } from "../types.ts";

export const BIN = new URL("../../bin/simulate.mjs", import.meta.url).pathname;

export async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else out.push(relative(root, abs).split(sep).join("/"));
    }
  };
  await walk(root);
  return out.sort();
}

/** Sorted relative paths with the SHA-256 of each file body. */
export async function treeHashes(root: string): Promise<Array<[string, string]>> {
  const files = await listFiles(root);
  return Promise.all(
    files.map(async (f) => [f, createHash("sha256").update(await readFile(join(root, f))).digest("hex")] as [string, string]),
  );
}

export async function readJson<T>(root: string, rel: string): Promise<T> {
  return JSON.parse(await readFile(join(root, rel), "utf8")) as T;
}

export interface Tree {
  manifest: Manifest;
  logs: Map<string, CdfLogFile>;
  cvrs: Map<string, CvrFile>;
  precincts: Map<string, TotalsFile>;
  county: TotalsFile;
  certified: TotalsFile;
}

export async function loadTree(root: string): Promise<Tree> {
  const manifest = await readJson<Manifest>(root, "manifest.json");
  const files = await listFiles(root);
  const logs = new Map<string, CdfLogFile>();
  const cvrs = new Map<string, CvrFile>();
  for (const f of files) {
    const log = /^machines\/([^/]+)\/vx-logs\.cdf\.json$/.exec(f);
    if (log) logs.set(log[1] as string, await readJson(root, f));
    const cvr = /^cvrs\/(.+)\.cvr\.json$/.exec(f);
    if (cvr) cvrs.set(cvr[1] as string, await readJson(root, f));
  }
  const precincts = new Map<string, TotalsFile>();
  for (const p of manifest.precincts) precincts.set(p, await readJson(root, totalsPath.precinct(p)));
  return {
    manifest,
    logs,
    cvrs,
    precincts,
    county: await readJson(root, totalsPath.county(manifest.countyId)),
    certified: await readJson(root, totalsPath.certified(manifest.countyId)),
  };
}

/**
 * Reference C1–C4 checks over the files only (CVRs stand in for the
 * ElectionGuard record). Returns the failing scope ids per check.
 */
export function runChecks(t: Tree): Record<CheckId, string[]> {
  const failed: Record<CheckId, string[]> = { C1: [], C2: [], C3: [], C4: [] };
  for (const m of t.manifest.machines) {
    const logged = castBallotIds(t.logs.get(m.id) as CdfLogFile).length;
    const cast = [...t.cvrs.values()].filter((c) => c.CastVoteRecordReport.CVR[0]?.CreatingDeviceId === m.id).length;
    if (logged !== cast) failed.C1.push(m.id);
  }
  for (const [p, reported] of t.precincts) {
    const cvrs = [...t.cvrs.values()].filter((c) => c.CastVoteRecordReport.CVR[0]?.BallotStyleUnitId === p);
    if (!sameCounts(tallyCvrs("precinct", p, cvrs), reported)) failed.C2.push(p);
  }
  if (!sameCounts(sumTotals("county-unofficial", t.manifest.countyId, [...t.precincts.values()]), t.county)) {
    failed.C3.push(t.manifest.countyId);
  }
  if (!sameCounts(t.county, t.certified)) failed.C4.push(t.manifest.countyId);
  return failed;
}
