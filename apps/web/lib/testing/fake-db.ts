// Test-only: an in-memory ServiceDb playing supabase/seed.sql (3 precincts, 3 machines, 17 + 17 + 16 CAST
// ballots) with fake-crypto ciphertexts. It mirrors the T-09 SQL functions closely enough for route tests:
// run_batch's stale check, statuses, batches, stage records and uploads. The SQL itself is tested in
// supabase/tests/t09-functions.test.ts. Never imported by app code.
import { createHash } from "node:crypto";
import type {
  BallotScope,
  BatchBallot,
  MismatchRow,
  RunBatchArgs,
  RunBatchResult,
  ServiceDb,
  StageTotalsRow,
  UploadInput,
  UploadRow,
} from "../official-db";
import { DbError } from "../official-db";
import { fakeCiphertext } from "./fake-crypto";

export const PRECINCT_COUNTY: Record<string, string> = { "18097-001": "18097", "18097-002": "18097", "18057-001": "18057" };
export const MACHINES: Record<string, string> = {
  "M-18097-001-A": "18097-001",
  "M-18097-002-A": "18097-002",
  "M-18057-001-A": "18057-001",
};

interface FakeBallot extends BatchBallot {
  precinct_id: string;
  tracking_code: string;
  status: string;
  mismatch: boolean;
  /** Each event as [from, to, type, reason]. */
  events: Array<{ from: string | null; to: string | null; type: string; reason: string | null }>;
}

/** Ballot i of a precinct votes like the fixture totals: president a/b/c by i % 3, measure yes/no by i % 2. */
export function fixtureChoices(i: number) {
  return {
    contests: [
      { contestId: "contest-president", choiceIds: [["cand-a", "cand-b", "cand-c"][i % 3]!] },
      { contestId: "contest-measure-1", choiceIds: [i % 2 === 0 ? "yes" : "no"] },
    ],
  };
}

const uuid = (n: number) => `00000000-0000-4000-9000-${n.toString(16).padStart(12, "0")}`;

export function fakeDb() {
  const ballots: FakeBallot[] = [];
  let n = 0;
  for (const [precinct, count] of [["18097-001", 17], ["18097-002", 17], ["18057-001", 16]] as const) {
    for (let i = 0; i < count; i++) {
      n++;
      const ciphertext = fakeCiphertext(fixtureChoices(i));
      ballots.push({
        id: uuid(n),
        tracking_code: `SEED-${String(n).padStart(4, "0")}`,
        ciphertext,
        ciphertext_hash: createHash("sha256").update(`${ciphertext}:${n}`).digest("hex"),
        machine_id: `M-${precinct}-A`,
        precinct_id: precinct,
        status: "CAST",
        mismatch: false,
        events: [{ from: null, to: null, type: "CAST", reason: null }],
      });
    }
  }
  const batches: Array<RunBatchArgs & { id: string }> = [];
  const stageRecords: Array<StageTotalsRow & { id: string; stage: string; merkle_root: string; signature: string }> = [];
  const uploads: Array<UploadRow & { uploaded_by: string }> = [];
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let ids = 0;
  const nextId = () => uuid(0xf00000 + ++ids);

  const inScope = (b: FakeBallot, scope: string, scopeId: string) =>
    scope === "precinct" ? b.precinct_id === scopeId : PRECINCT_COUNTY[b.precinct_id] === scopeId;
  const byHash = (a: FakeBallot, b: FakeBallot) => (a.ciphertext_hash < b.ciphertext_hash ? -1 : 1);

  function record(list: UploadInput[], actor: string): UploadRow[] {
    return list.map((u) => {
      const found = uploads.find((x) => x.kind === u.kind && x.scope_id === u.scope_id && x.file_sha256 === u.file_sha256);
      if (found) return { id: found.id, kind: found.kind, scope_id: found.scope_id, file_sha256: found.file_sha256 };
      const row = { id: nextId(), ...u, uploaded_by: actor };
      uploads.push(row);
      return { id: row.id, kind: row.kind, scope_id: row.scope_id, file_sha256: row.file_sha256 };
    });
  }

  const db: ServiceDb = {
    async statusCounts(scope, scopeId) {
      calls.push({ method: "statusCounts", args: [scope, scopeId] });
      const counts: Record<string, number> = {};
      for (const b of ballots.filter((b) => inScope(b, scope, scopeId))) counts[b.status] = (counts[b.status] ?? 0) + 1;
      return counts;
    },
    async batchBallots(scope, scopeId, from) {
      calls.push({ method: "batchBallots", args: [scope, scopeId, from] });
      return ballots
        .filter((b) => b.status === from && inScope(b, scope, scopeId))
        .sort(byHash)
        .map(({ id, ciphertext, ciphertext_hash, machine_id }) => ({ id, ciphertext, ciphertext_hash, machine_id }));
    },
    async machineBallotCounts(precinctId) {
      calls.push({ method: "machineBallotCounts", args: [precinctId] });
      const counts: Record<string, number> = {};
      for (const b of ballots.filter((b) => b.precinct_id === precinctId && b.status !== "SPOILED")) {
        counts[b.machine_id] = (counts[b.machine_id] ?? 0) + 1;
      }
      return counts;
    },
    async precinctMachines(precinctId) {
      calls.push({ method: "precinctMachines", args: [precinctId] });
      return Object.keys(MACHINES).filter((m) => MACHINES[m] === precinctId);
    },
    async stageTotals(scope, scopeId, stage) {
      calls.push({ method: "stageTotals", args: [scope, scopeId, stage] });
      return stageRecords
        .filter((r) => r.stage === stage && ((r.scope === scope && r.scope_id === scopeId) || (scope === "county" && r.scope === "precinct" && PRECINCT_COUNTY[r.scope_id] === scopeId)))
        .map(({ scope, scope_id, ballot_count, totals }) => ({ scope, scope_id, ballot_count, totals: JSON.parse(JSON.stringify(totals)) }));
    },
    async challengeRemoved(countyId) {
      calls.push({ method: "challengeRemoved", args: [countyId] });
      return ballots
        .filter((b) => PRECINCT_COUNTY[b.precinct_id] === countyId && ["CHALLENGED", "DISCARDED"].includes(b.status))
        .filter((b) => b.events.some((e) => e.from === "REPORTED_UNOFFICIAL" && e.to === "CHALLENGED"))
        .map((b) => b.ciphertext);
    },
    async recordUploads(list, actor) {
      calls.push({ method: "recordUploads", args: [list, actor] });
      return record(list, actor);
    },
    async runBatch(args): Promise<RunBatchResult> {
      calls.push({ method: "runBatch", args: [args] });
      const scoped = ballots.filter((b) => b.status === args.from && inScope(b, args.scope, args.scopeId));
      const named = [...args.advance, ...args.challenge.map((c) => c.id)].sort();
      if (scoped.length === 0 || JSON.stringify(scoped.map((b) => b.id).sort()) !== JSON.stringify(named)) {
        throw new DbError("stale batch: the ballots in scope changed", "VB409");
      }
      if ((args.advance.length > 0) !== (args.stageRecord !== null)) throw new DbError("stage record mismatch", "VB400");
      const id = nextId();
      batches.push({ ...args, id });
      for (const b of scoped) {
        const challenge = args.challenge.find((c) => c.id === b.id);
        const to = challenge ? "CHALLENGED" : args.to;
        b.events.push({ from: args.from, to, type: challenge ? "MISMATCH_DETECTED" : "STATUS_CHANGE", reason: challenge ? `Cross-check ${challenge.check} failed` : null });
        b.status = to;
        b.mismatch ||= !!challenge;
      }
      let stageId: string | null = null;
      if (args.stageRecord) {
        stageId = nextId();
        stageRecords.push({ id: stageId, scope: args.scope, scope_id: args.scopeId, stage: args.to, ballot_count: args.stageRecord.ballot_count, totals: args.stageRecord.totals, merkle_root: args.stageRecord.merkle_root, signature: args.stageRecord.signature });
      }
      record(args.uploads, args.actorId);
      return { batch_id: id, count: args.advance.length, challenged: args.challenge.length, stage_record_id: stageId };
    },
    async ballotScope(ballotId): Promise<BallotScope | null> {
      calls.push({ method: "ballotScope", args: [ballotId] });
      const b = ballots.find((x) => x.id === ballotId);
      if (!b) return null;
      const head = b.events.at(-1)!;
      return {
        precinct_id: b.precinct_id,
        county_id: PRECINCT_COUNTY[b.precinct_id]!,
        current_status: b.status,
        held_status: b.status === "CHALLENGED" && head.to === "CHALLENGED" ? head.from : null,
      };
    },
    async resolveChallenge(ballotId, to, reason, role, actor) {
      calls.push({ method: "resolveChallenge", args: [ballotId, to, reason, role, actor] });
      const b = ballots.find((x) => x.id === ballotId)!;
      if (b.status !== "CHALLENGED") throw new DbError("ballot is not challenged", "VB409");
      b.events.push({ from: "CHALLENGED", to, type: "CHALLENGE_RESOLVED", reason });
      b.status = to;
      return to;
    },
    async mismatches(scope, scopeId): Promise<MismatchRow[]> {
      calls.push({ method: "mismatches", args: [scope, scopeId] });
      return ballots
        .filter((b) => (b.mismatch || b.status === "CHALLENGED") && inScope(b, scope, scopeId))
        .map((b) => {
          const event = [...b.events].reverse().find((e) => e.to === "CHALLENGED");
          return {
            ballot_id: b.id,
            tracking_code: b.tracking_code,
            precinct_id: b.precinct_id,
            machine_id: b.machine_id,
            current_status: b.status,
            reason: event?.reason ?? null,
            // PostgREST returns a date column as YYYY-MM-DD.
            detected_on: "2026-11-03",
          };
        });
    },
  };

  /** Challenges a ballot directly, as an official challenge would (for C4 and resolve tests). */
  function challenge(ballotId: string, reason = "Board review") {
    const b = ballots.find((x) => x.id === ballotId)!;
    b.events.push({ from: b.status, to: "CHALLENGED", type: "STATUS_CHANGE", reason });
    b.status = "CHALLENGED";
  }

  const writes = () => calls.filter((c) => ["runBatch", "recordUploads", "resolveChallenge"].includes(c.method));
  return { db, ballots, batches, stageRecords, uploads, calls, writes, challenge };
}
