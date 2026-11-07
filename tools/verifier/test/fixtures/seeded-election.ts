// A seeded county, published the way the record producers write it. This file plays the server: it
// uses the scale-demo seed (tools/scale-demo, real @vbt/crypto and @vbt/events) for the precinct
// records, and @vbt/crypto with @vbt/events' stageLeaves for the county records. The independent
// check never imports this file's dependencies; it only receives the JSON built here.

import { aggregateDecrypt, buildMerkleTree, type ContestTotals, generateElectionKeyPair, generateSigningKeyPair, signStageRecord } from "@vbt/crypto";
import { sortStageLeaves, stageLeaves } from "@vbt/events";
import { buildPlan, buildRows, MANIFEST, realCrypto } from "@vbt/scale-demo";
import type { PublishedProof, PublishedRecord, Stage } from "../../src/record.ts";

export type SeededElection = {
  /** The election office's stage signing public key (32 bytes). */
  publicKey: Uint8Array;
  precincts: PublishedRecord[];
  unofficial: PublishedRecord;
  certified: PublishedRecord;
  challenged: PublishedRecord;
  /** A receipt (code and ciphertext hash) and its proof for each precinct record and the unofficial record. */
  receipts: { record: PublishedRecord; code: string; ciphertext_hash: string; proof: PublishedProof }[];
};

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

type Member = { tracking_code: string; ciphertext_hash: string; ciphertext: Uint8Array };

async function countyRecord(
  stage: Stage,
  countyId: string,
  members: readonly Member[],
  electionSecretKey: Uint8Array,
  signingSecretKey: Uint8Array,
  publishedOn: string,
): Promise<PublishedRecord> {
  const ordered = sortStageLeaves(members);
  const merkle_root = hex(buildMerkleTree(stageLeaves(ordered)).root);
  const totals: ContestTotals = await aggregateDecrypt(
    ordered.map((m) => m.ciphertext),
    electionSecretKey,
    MANIFEST,
  );
  const signature = await signStageRecord({ scope: "county", stage, merkleRoot: merkle_root, ballotCount: ordered.length, totals }, signingSecretKey);
  return {
    scope: "county",
    scope_id: countyId,
    stage,
    merkle_root,
    ballot_count: ordered.length,
    totals,
    published_on: publishedOn,
    signature: b64(signature),
    ballots: ordered.map((m) => ({ tracking_code: m.tracking_code, ciphertext_hash: m.ciphertext_hash })),
  };
}

function receiptFor(record: PublishedRecord, which: number) {
  const ballot = record.ballots[which % record.ballots.length];
  if (!ballot) throw new Error("record lists no ballots");
  const { proofs } = buildMerkleTree(stageLeaves(record.ballots));
  const index = record.ballots.indexOf(ballot);
  const proof = proofs[index];
  if (!proof) throw new Error("no proof");
  return {
    record,
    code: ballot.tracking_code,
    ciphertext_hash: ballot.ciphertext_hash,
    proof: { scope_id: record.scope_id, stage: record.stage, path: proof.steps.map((s) => ({ side: s.side, hash: hex(s.sibling) })) },
  };
}

/**
 * Seeds `ballots` ballots over `precincts` precincts with the scale-demo seed, then publishes the
 * county's unofficial report, a certification that drops one ballot, and the challenge explaining it.
 */
export async function seededElection(options = { ballots: 61, precincts: 3, rate: 0.05, seed: "t-15a" }): Promise<SeededElection> {
  const election = await generateElectionKeyPair();
  const signing = await generateSigningKeyPair();
  const rows = await buildRows(buildPlan(options), realCrypto, {
    electionPublicKey: election.publicKey,
    electionSecretKey: election.secretKey,
    stageSigningPublicKey: signing.publicKey,
    stageSigningSecretKey: signing.secretKey,
  });

  const mismatched = new Set(rows.statuses.filter((s) => s.mismatch).map((s) => s.id));
  const tallied: (Member & { precinct_id: string })[] = rows.ballots
    .filter((b) => !mismatched.has(b.id))
    .map((b) => ({
      tracking_code: b.tracking_code,
      ciphertext_hash: b.ciphertext_hash,
      ciphertext: new Uint8Array(Buffer.from(b.ciphertext, "base64")),
      precinct_id: b.precinct_id,
    }));

  // The seed's own precinct records, as GET /api/record would serve them.
  const precincts: PublishedRecord[] = rows.stageRecords.map((s) => ({
    scope: s.scope,
    scope_id: s.scope_id,
    stage: "TALLIED_PRECINCT",
    merkle_root: s.merkle_root,
    ballot_count: s.ballot_count,
    totals: s.totals,
    published_on: "2026-11-03",
    signature: s.signature,
    ballots: sortStageLeaves(tallied.filter((b) => b.precinct_id === s.scope_id)).map((b) => ({
      tracking_code: b.tracking_code,
      ciphertext_hash: b.ciphertext_hash,
    })),
  }));

  const sign = (stage: Stage, members: readonly Member[], on: string) =>
    countyRecord(stage, rows.countyId, members, election.secretKey, signing.secretKey, on);

  const dropped = sortStageLeaves(tallied)[0] as Member;
  const unofficial = await sign("REPORTED_UNOFFICIAL", tallied, "2026-11-04");
  const certified = await sign("CERTIFIED", tallied.filter((m) => m !== dropped), "2026-11-17");
  const challenged = await sign("CHALLENGED", [dropped], "2026-11-10");

  return {
    publicKey: signing.publicKey,
    precincts,
    unofficial,
    certified,
    challenged,
    receipts: [...precincts.map((p, i) => receiptFor(p, i * 7 + 1)), receiptFor(unofficial, 5)],
  };
}
