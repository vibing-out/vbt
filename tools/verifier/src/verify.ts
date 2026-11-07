// tools/verifier's checks (docs/record-format.md §10). Every Merkle and signature operation goes
// through @vbt/crypto, and the leaf layout and order come from @vbt/events' stageLeaves, so this
// verifier checks records with exactly the code that writes them. Nothing here hashes or signs.
//
// Results name check ids, scope ids, stages, contest and choice ids, counts and at most five
// tracking codes: never a time, a leaf position or a ciphertext.

import { buildMerkleTree, verifyInclusionProof, verifyStageRecord } from "@vbt/crypto";
import { hexToBytes, sortStageLeaves, stageLeaf, stageLeaves } from "@vbt/events";
import { type PublishedProof, type PublishedRecord, signatureBytes, type Totals } from "./record.ts";

export type CheckId = "ballot-count" | "leaf-order" | "merkle-root" | "signature" | "c2" | "c3" | "c4" | "inclusion";

export type CheckResult = { check: CheckId; scope_id: string; stage: string; ok: boolean; failures: string[] };

const result = (check: CheckId, scope_id: string, stage: string, failures: string[]): CheckResult => ({
  check,
  scope_id,
  stage,
  ok: failures.length === 0,
  failures,
});

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const firstFive = (codes: string[]) => [...codes].sort().slice(0, 5).join(", ");

function repeated(codes: Iterable<string>): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const code of codes) (seen.has(code) ? twice : seen).add(code);
  return [...twice];
}

export const NO_KEY = "no stage signing public key given (use --public-key or STAGE_SIGNING_PUBLIC_KEY)";

/** ballot-count, leaf-order, merkle-root and signature for one record. */
export async function checkRecord(r: PublishedRecord, publicKey: Uint8Array | null): Promise<CheckResult[]> {
  const { scope_id, stage } = r;

  const countFailures: string[] = [];
  if (r.ballot_count !== r.ballots.length) countFailures.push(`ballot_count ${r.ballot_count} != ${r.ballots.length} ballots listed`);
  const twice = repeated(r.ballots.map((b) => b.tracking_code));
  if (twice.length > 0) countFailures.push(`${twice.length} tracking codes are listed more than once: ${firstFive(twice)}`);

  const sorted = sortStageLeaves(r.ballots);
  const inOrder = sorted.every((b, i) => b === r.ballots[i]);
  const orderFailures = inOrder ? [] : ["ballots are not in leaf order (ciphertext_hash, then tracking_code)"];

  const root = hex(buildMerkleTree(stageLeaves(r.ballots)).root);
  const rootFailures = root === r.merkle_root ? [] : [`recomputed root ${root} != published root ${r.merkle_root}`];

  let signatureFailures: string[];
  if (!publicKey) {
    signatureFailures = [NO_KEY];
  } else {
    const ok = await verifyStageRecord(
      { scope: r.scope, stage: r.stage, merkleRoot: r.merkle_root, ballotCount: r.ballot_count, totals: r.totals },
      signatureBytes(r.signature),
      publicKey,
    );
    signatureFailures = ok ? [] : ["signature does not match the stage signing key"];
  }

  return [
    result("ballot-count", scope_id, stage, countFailures),
    result("leaf-order", scope_id, stage, orderFailures),
    result("merkle-root", scope_id, stage, rootFailures),
    result("signature", scope_id, stage, signatureFailures),
  ];
}

const isCount = (v: number | undefined): boolean => v !== undefined && Number.isSafeInteger(v) && v >= 0;
const get = (t: Totals, contest: string, choice: string): number => t[contest]?.[choice] ?? 0;

function choiceKeys(...all: Totals[]): [string, string][] {
  const keys = new Set<string>();
  for (const t of all) for (const [c, row] of Object.entries(t)) for (const k of Object.keys(row)) keys.add(JSON.stringify([c, k]));
  return [...keys].sort().map((k) => JSON.parse(k) as [string, string]);
}

const ballotSet = (r: PublishedRecord) => new Map(r.ballots.map((b) => [b.tracking_code, b.ciphertext_hash]));

/** C2: every total is a count, and no choice has more votes than the record has ballots. */
export function checkC2(p: PublishedRecord): CheckResult {
  const failures: string[] = [];
  for (const [contest, choice] of choiceKeys(p.totals)) {
    const v = p.totals[contest]?.[choice];
    if (!isCount(v)) failures.push(`total ${contest}/${choice} is not a non-negative integer`);
    else if ((v as number) > p.ballot_count) failures.push(`${contest}/${choice} has ${v} votes for ${p.ballot_count} ballots`);
  }
  return result("c2", p.scope_id, p.stage, failures);
}

/** C3: the county's REPORTED_UNOFFICIAL record is the sum and union of its precincts' records. */
export function checkC3(precincts: readonly PublishedRecord[], county: PublishedRecord): CheckResult {
  const failures: string[] = [];
  for (const [contest, choice] of choiceKeys(county.totals, ...precincts.map((p) => p.totals))) {
    const a = get(county.totals, contest, choice);
    const b = precincts.reduce((n, p) => n + get(p.totals, contest, choice), 0);
    if (a !== b) failures.push(`${contest}/${choice} county total ${a} != sum of precinct totals ${b}`);
  }
  const sum = precincts.reduce((n, p) => n + p.ballot_count, 0);
  if (county.ballot_count !== sum) failures.push(`ballot_count ${county.ballot_count} != sum of precinct ballot counts ${sum}`);
  const across = repeated(precincts.flatMap((p) => [...new Set(p.ballots.map((b) => b.tracking_code))]));
  if (across.length > 0) failures.push(`${across.length} tracking codes are listed in more than one precinct: ${firstFive(across)}`);
  const union = new Map<string, string>();
  for (const p of precincts) for (const b of p.ballots) union.set(b.tracking_code, b.ciphertext_hash);
  const countySet = ballotSet(county);
  let differ = 0;
  for (const [code, hash] of countySet) if (union.get(code) !== hash) differ++;
  for (const code of union.keys()) if (!countySet.has(code)) differ++;
  if (differ > 0) failures.push(`ballot set differs from its precincts by ${differ} codes`);
  return result("c3", county.scope_id, county.stage, failures);
}

/** C4: every certified change from the unofficial record is explained by a challenge or discard. */
export function checkC4(
  unofficial: PublishedRecord,
  certified: PublishedRecord,
  challenged: PublishedRecord | null,
  discarded: PublishedRecord | null,
): CheckResult {
  const failures: string[] = [];
  const before = ballotSet(unofficial);
  const after = ballotSet(certified);
  const notBefore = [...after].filter(([code, hash]) => before.get(code) !== hash).length;
  if (notBefore > 0) failures.push(`${notBefore} certified ballots are not in the unofficial record`);
  const explained = new Set([...(challenged?.ballots ?? []), ...(discarded?.ballots ?? [])].map((b) => b.tracking_code));
  const removed = [...before.keys()].filter((code) => !after.has(code));
  const unexplained = removed.filter((code) => !explained.has(code));
  if (unexplained.length > 0) {
    failures.push(`${unexplained.length} ballots missing from certified with no challenge or discard: ${firstFive(unexplained)}`);
  }
  for (const [contest, choice] of choiceKeys(unofficial.totals, certified.totals)) {
    const c = get(certified.totals, contest, choice);
    const u = get(unofficial.totals, contest, choice);
    if (c > u) failures.push(`${contest}/${choice} certified ${c} > unofficial ${u}`);
    else if (u - c > removed.length) failures.push(`${contest}/${choice} lost ${u - c} votes but only ${removed.length} ballots were removed`);
  }
  return result("c4", certified.scope_id, certified.stage, failures);
}

/** inclusion: the receipt's code and ciphertext hash are a leaf of the record, by the proof and by the list. */
export function checkInclusion(record: PublishedRecord, code: string, ciphertextHash: string, proof: PublishedProof): CheckResult {
  const failures: string[] = [];
  if (!record.ballots.some((b) => b.tracking_code === code && b.ciphertext_hash === ciphertextHash)) {
    failures.push(`code not in ${record.scope_id}/${record.stage}`);
  }
  let reaches = false;
  try {
    reaches = verifyInclusionProof(
      stageLeaf(code, ciphertextHash),
      { steps: proof.path.map((s) => ({ side: s.side, sibling: hexToBytes(s.hash) })) },
      hexToBytes(record.merkle_root),
    );
  } catch {
    reaches = false;
  }
  if (!reaches) failures.push("proof does not reach the published root");
  return result("inclusion", code, proof.stage, failures);
}

/** One county's published records. */
export type CountyRecords = {
  precincts: readonly PublishedRecord[];
  unofficial?: PublishedRecord | null;
  certified?: PublishedRecord | null;
  challenged?: PublishedRecord | null;
  discarded?: PublishedRecord | null;
};

/** Every check §10 lists for one county, in a fixed order. */
export async function verifyCounty(records: CountyRecords, publicKey: Uint8Array | null): Promise<{ checks: CheckResult[]; ok: boolean }> {
  const { precincts, unofficial = null, certified = null, challenged = null, discarded = null } = records;
  const checks: CheckResult[] = [];
  for (const r of [...precincts, unofficial, certified, challenged, discarded]) {
    if (r) checks.push(...(await checkRecord(r, publicKey)));
  }
  for (const p of precincts) checks.push(checkC2(p));
  if (unofficial) checks.push(checkC3(precincts, unofficial));
  if (unofficial && certified) checks.push(checkC4(unofficial, certified, challenged, discarded));
  return { checks, ok: checks.every((c) => c.ok) };
}
