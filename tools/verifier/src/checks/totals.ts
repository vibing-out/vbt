// C2 to C4 (docs/locked-interfaces.md § Cross-checks) from the published
// records alone. The verifier cannot decrypt, so each check compares signed
// totals, counts and ballot sets. Messages name contests, choices, counts and
// (for C3 and C4) at most five tracking codes, sorted alphabetically.

import type { ContestTotals } from "../crypto.ts";
import type { PublishedRecord } from "../record.ts";
import { type Check, outcome } from "../report.ts";
import { repeatedCodes, repeatedMessage } from "./merkle.ts";

const isCount = (v: number | undefined): v is number => v !== undefined && Number.isSafeInteger(v) && v >= 0;

function choiceKeys(...all: ContestTotals[]): [string, string][] {
  const keys = new Set<string>();
  for (const t of all) for (const [c, row] of Object.entries(t)) for (const k of Object.keys(row)) keys.add(JSON.stringify([c, k]));
  return [...keys].sort().map((k) => JSON.parse(k) as [string, string]);
}

const get = (t: ContestTotals, contest: string, choice: string): number => t[contest]?.[choice] ?? 0;

const contestSum = (t: ContestTotals, contest: string): number =>
  Object.values(t[contest] ?? {}).reduce((n, v) => n + (isCount(v) ? v : 0), 0);

const contests = (...all: ContestTotals[]): string[] => [...new Set(all.flatMap((t) => Object.keys(t)))].sort();

/** C2: a precinct's TALLIED_PRECINCT totals are non-negative integers, and no contest has more votes than ballots. */
export function checkC2(p: PublishedRecord): Check[] {
  const failures: string[] = [];
  for (const [contest, choice] of choiceKeys(p.totals)) {
    if (!isCount(p.totals[contest]?.[choice])) failures.push(`total ${contest}/${choice} is not a non-negative integer`);
  }
  for (const contest of contests(p.totals)) {
    const votes = contestSum(p.totals, contest);
    if (votes > p.ballot_count) failures.push(`contest ${contest} has ${votes} votes for ${p.ballot_count} ballots`);
  }
  return outcome("c2", p.scope_id, p.stage, failures);
}

/** Number of tracking codes in either map that are missing from the other or listed with a different ciphertext hash. */
function setDifference(a: Map<string, string>, b: Map<string, string>): number {
  let k = 0;
  for (const [code, hash] of a) if (b.get(code) !== hash) k++;
  for (const code of b.keys()) if (!a.has(code)) k++;
  return k;
}

/** Collapses a code listed twice in one record; ballot-count fails that record, so C3 and C4 need not repeat it. */
const ballotMap = (r: PublishedRecord) => new Map(r.ballots.map((b) => [b.tracking_code, b.ciphertext_hash]));

/** C3: the county REPORTED_UNOFFICIAL record is the sum (totals, count) and union (ballots) of its precincts. */
export function checkC3(precincts: PublishedRecord[], county: PublishedRecord): Check[] {
  const failures: string[] = [];
  for (const [contest, choice] of choiceKeys(county.totals, ...precincts.map((p) => p.totals))) {
    const a = get(county.totals, contest, choice);
    const b = precincts.reduce((n, p) => n + get(p.totals, contest, choice), 0);
    if (a !== b) failures.push(`${contest}/${choice} county total ${a} != sum of precinct totals ${b}`);
  }
  const sumCount = precincts.reduce((n, p) => n + p.ballot_count, 0);
  if (county.ballot_count !== sumCount) failures.push(`ballot_count ${county.ballot_count} != sum of precinct ballot counts ${sumCount}`);
  // A code in two precincts would collapse into one entry of the union below.
  const across = repeatedCodes(precincts.flatMap((p) => [...new Set(p.ballots.map((b) => b.tracking_code))]));
  if (across.length > 0) failures.push(repeatedMessage(across, " across precincts"));
  const union = new Map<string, string>();
  for (const p of precincts) for (const b of p.ballots) union.set(b.tracking_code, b.ciphertext_hash);
  const k = setDifference(ballotMap(county), union);
  if (k > 0) failures.push(`ballot set differs from its precincts by ${k} codes`);
  return outcome("c3", county.scope_id, county.stage, failures);
}

/**
 * C4: every ballot removed between REPORTED_UNOFFICIAL and CERTIFIED is in a
 * DISCARDED record or a still-open CHALLENGED record; no certified total is
 * above its unofficial total; and no contest loses more votes than ballots were
 * removed. A CHALLENGED or DISCARDED record that is not published counts as
 * listing no ballots, so withholding it can only make C4 fail.
 */
export function checkC4(
  unofficial: PublishedRecord,
  certified: PublishedRecord,
  challenged: PublishedRecord | null,
  discarded: PublishedRecord | null,
): Check[] {
  const failures: string[] = [];
  const before = ballotMap(unofficial);
  const after = ballotMap(certified);
  const explained = new Set([...(challenged?.ballots ?? []), ...(discarded?.ballots ?? [])].map((b) => b.tracking_code));
  const removed = [...before.keys()].filter((code) => !after.has(code));
  const unexplained = removed.filter((code) => !explained.has(code)).sort();
  if (unexplained.length > 0) {
    failures.push(
      `${unexplained.length} ballots missing from certified with no challenge or discard: ${unexplained.slice(0, 5).join(", ")}`,
    );
  }
  const added = [...after.keys()].filter((code) => !before.has(code)).length;
  if (added > 0) failures.push(`${added} certified ballots are not in the unofficial record`);
  for (const [contest, choice] of choiceKeys(unofficial.totals, certified.totals)) {
    const a = get(certified.totals, contest, choice);
    const b = get(unofficial.totals, contest, choice);
    if (a > b) failures.push(`${contest}/${choice} certified ${a} > unofficial ${b}`);
  }
  for (const contest of contests(unofficial.totals, certified.totals)) {
    const lost = contestSum(unofficial.totals, contest) - contestSum(certified.totals, contest);
    if (lost > removed.length) failures.push(`contest ${contest} lost ${lost} votes but only ${removed.length} ballots were removed`);
  }
  return outcome("c4", certified.scope_id, certified.stage, failures);
}
