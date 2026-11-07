import "server-only";
import { createHash } from "node:crypto";
import { buildMerkleTree, computeTrackingCode, verifyInclusionProof } from "@vbt/crypto";
import { publicLabel, type BallotStatus } from "@vbt/domain";

// Demo fixture for the public tracker: a small, deterministic Marion County election built with the
// real @vbt/crypto tracking-code and Merkle code. It stands in for the database until T-05 (ingest,
// stage records) and T-11 (seed data) land. Ciphertexts are deterministic stand-in bytes, so the
// tracking codes stay the same across deploys. No choices, names or times are held here.

type Stage = "TALLIED_PRECINCT" | "REPORTED_UNOFFICIAL" | "CERTIFIED";

type DemoBallot = {
  trackingCode: string;
  precinctId: string;
  ciphertextHash: Uint8Array;
  status: BallotStatus;
  reason?: string;
};

type StageRecordView = {
  stage: Stage;
  scope: string;
  date: string;
  merkleRoot: string;
  ballotCount: number;
  proofs: Map<string, ReturnType<typeof buildMerkleTree>["proofs"][number]>;
  leaves: Map<string, Uint8Array>;
};

export type TimelineEntry = {
  status: BallotStatus;
  label: string;
  date: string;
  record: { scope: string; merkleRoot: string; ballotCount: number; included: boolean } | null;
};

export type TrackView = {
  trackingCode: string;
  precinct: string;
  county: string;
  status: BallotStatus;
  statusLabel: string;
  reason: string | null;
  ciphertextHash: string;
  timeline: TimelineEntry[];
  allChecksPass: boolean;
};

const COUNTY = { id: "marion", name: "Marion County" };
const PRECINCTS = [
  { id: "precinct-12", name: "Precinct 12", ballots: 16, stageReached: "CERTIFIED" as Stage },
  { id: "precinct-7", name: "Precinct 7", ballots: 12, stageReached: "TALLIED_PRECINCT" as Stage },
];
const CAST_DATE = "2026-11-03";
const STAGE_DATES: Record<Stage, string> = {
  TALLIED_PRECINCT: "2026-11-03",
  REPORTED_UNOFFICIAL: "2026-11-04",
  CERTIFIED: "2026-11-17",
};
const STAGE_ORDER: Stage[] = ["TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "CERTIFIED"];

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const sha256 = (text: string) => new Uint8Array(createHash("sha256").update(text).digest());

function reached(stage: Stage, upTo: Stage): boolean {
  return STAGE_ORDER.indexOf(stage) <= STAGE_ORDER.indexOf(upTo);
}

function buildElection() {
  const ballots: DemoBallot[] = [];
  for (const precinct of PRECINCTS) {
    let prev: string | null = null;
    for (let i = 0; i < precinct.ballots; i++) {
      const ciphertext = sha256(`vbt-demo:${precinct.id}:machine-1:${i}`);
      const trackingCode: string = computeTrackingCode(ciphertext, prev);
      prev = trackingCode;
      ballots.push({
        trackingCode,
        precinctId: precinct.id,
        ciphertextHash: sha256(hex(ciphertext)),
        status: precinct.stageReached,
      });
    }
  }
  // One ballot in Precinct 7 was flagged by a cross-check and is under review; one in Precinct 12
  // was a provisional ballot the county board rejected.
  const challenged = ballots.find((b) => b.precinctId === "precinct-7");
  if (challenged) challenged.status = "CHALLENGED";
  const discarded = ballots.filter((b) => b.precinctId === "precinct-12").at(-1);
  if (discarded) {
    discarded.status = "DISCARDED";
    discarded.reason = "Provisional ballot: the county election board could not confirm the voter's registration.";
  }

  const records: StageRecordView[] = [];
  for (const stage of STAGE_ORDER) {
    // Precinct tallies are per precinct; election-night and certification are per county.
    const scopes =
      stage === "TALLIED_PRECINCT"
        ? PRECINCTS.filter((p) => reached(stage, p.stageReached)).map((p) => ({ scope: p.name, ids: [p.id] }))
        : [{ scope: COUNTY.name, ids: PRECINCTS.filter((p) => reached(stage, p.stageReached)).map((p) => p.id) }];
    for (const { scope, ids } of scopes) {
      if (ids.length === 0) continue;
      const members = ballots.filter(
        (b) => ids.includes(b.precinctId) && b.status !== "CHALLENGED" && b.status !== "DISCARDED",
      );
      const tree = buildMerkleTree(members.map((b) => b.ciphertextHash));
      records.push({
        stage,
        scope,
        date: STAGE_DATES[stage],
        merkleRoot: hex(tree.root),
        ballotCount: members.length,
        proofs: new Map(members.map((b, i) => [b.trackingCode, tree.proofs[i]!])),
        leaves: new Map(members.map((b) => [b.trackingCode, b.ciphertextHash])),
      });
      // Keep the root bytes for verification.
      rootBytes.set(`${stage}:${scope}`, tree.root);
    }
  }
  return { ballots, records };
}

const rootBytes = new Map<string, Uint8Array>();
let election: ReturnType<typeof buildElection> | null = null;
function getElection() {
  election ??= buildElection();
  return election;
}

/** Normalizes what a voter types: case, spaces and dashes. */
export function normalizeCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

export function lookup(input: string): TrackView | null {
  const code = normalizeCode(input);
  const { ballots, records } = getElection();
  const ballot = ballots.find((b) => b.trackingCode === code);
  if (!ballot) return null;
  const precinct = PRECINCTS.find((p) => p.id === ballot.precinctId)!;

  const timeline: TimelineEntry[] = [{ status: "CAST", label: publicLabel("CAST"), date: CAST_DATE, record: null }];
  for (const record of records) {
    const proof = record.proofs.get(code);
    const leaf = record.leaves.get(code);
    if (!proof || !leaf) continue;
    const root = rootBytes.get(`${record.stage}:${record.scope}`)!;
    timeline.push({
      status: record.stage,
      label: publicLabel(record.stage),
      date: record.date,
      record: {
        scope: record.scope,
        merkleRoot: record.merkleRoot,
        ballotCount: record.ballotCount,
        included: verifyInclusionProof(leaf, proof, root),
      },
    });
  }
  if (ballot.status === "CHALLENGED" || ballot.status === "DISCARDED") {
    timeline.push({ status: ballot.status, label: publicLabel(ballot.status), date: STAGE_DATES.TALLIED_PRECINCT, record: null });
  }

  return {
    trackingCode: code,
    precinct: precinct.name,
    county: COUNTY.name,
    status: ballot.status,
    statusLabel: publicLabel(ballot.status),
    reason: ballot.reason ?? null,
    ciphertextHash: hex(ballot.ciphertextHash),
    timeline,
    allChecksPass: timeline.every((t) => t.record === null || t.record.included),
  };
}

/** A few codes judges can try, one per interesting outcome. */
export function sampleCodes(): { code: string; note: string }[] {
  const { ballots } = getElection();
  const certified = ballots.find((b) => b.status === "CERTIFIED")!;
  const tallied = ballots.find((b) => b.status === "TALLIED_PRECINCT")!;
  const challenged = ballots.find((b) => b.status === "CHALLENGED")!;
  const discarded = ballots.find((b) => b.status === "DISCARDED")!;
  return [
    { code: certified.trackingCode, note: "Precinct 12, certified" },
    { code: tallied.trackingCode, note: "Precinct 7, counted at precinct" },
    { code: challenged.trackingCode, note: "Under review" },
    { code: discarded.trackingCode, note: "Not counted, reason shown" },
  ];
}
