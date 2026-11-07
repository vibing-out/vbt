import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only access to the private ballot tables for the official tools (T-09). Every call is an rpc to a
// public.official_* function (supabase/migrations/20261107240100_t09_official_functions.sql) that only
// service_role may execute, so this module needs SUPABASE_SECRET_KEY. Callers use it only after
// requireRole has passed. Each write is one rpc, which PostgREST runs in one transaction.

type Env = Readonly<Record<string, string | undefined>>;

export type Scope = "precinct" | "county";

export interface BatchBallot {
  id: string;
  ciphertext: string;
  ciphertext_hash: string;
  machine_id: string;
}

export interface StageTotalsRow {
  scope: Scope;
  scope_id: string;
  ballot_count: number;
  totals: Record<string, Record<string, number>>;
}

export interface UploadInput {
  file_sha256: string;
  kind: string;
  scope_id: string;
}

export interface UploadRow extends UploadInput {
  id: string;
}

export interface RunBatchArgs {
  scope: Scope;
  scopeId: string;
  from: string;
  to: string;
  actorRole: string;
  actorId: string;
  advance: string[];
  challenge: Array<{ id: string; check: string }>;
  stageRecord: { merkle_root: string; ballot_count: number; totals: Record<string, Record<string, number>>; signature: string } | null;
  uploads: UploadInput[];
}

export interface RunBatchResult {
  batch_id: string;
  count: number;
  challenged: number;
  stage_record_id: string | null;
}

export interface BallotScope {
  precinct_id: string;
  county_id: string;
  current_status: string;
  held_status: string | null;
}

export interface MismatchRow {
  ballot_id: string;
  tracking_code: string;
  precinct_id: string;
  machine_id: string;
  current_status: string;
  reason: string | null;
  /** YYYY-MM-DD; never a time. */
  detected_on: string | null;
}

/** What the official tools read and write. Tests pass an in-memory fake (lib/testing/fake-db.ts). */
export interface ServiceDb {
  statusCounts(scope: Scope, scopeId: string): Promise<Record<string, number>>;
  batchBallots(scope: Scope, scopeId: string, from: string): Promise<BatchBallot[]>;
  machineBallotCounts(precinctId: string): Promise<Record<string, number>>;
  precinctMachines(precinctId: string): Promise<string[]>;
  stageTotals(scope: Scope, scopeId: string, stage: string): Promise<StageTotalsRow[]>;
  challengeRemoved(countyId: string): Promise<string[]>;
  recordUploads(uploads: UploadInput[], actorId: string): Promise<UploadRow[]>;
  runBatch(args: RunBatchArgs): Promise<RunBatchResult>;
  ballotScope(ballotId: string): Promise<BallotScope | null>;
  resolveChallenge(ballotId: string, to: string, reason: string | null, actorRole: string, actorId: string): Promise<string>;
  mismatches(scope: Scope, scopeId: string): Promise<MismatchRow[]>;
}

/** A failed database call. `code` is the SQLSTATE: VB400, VB404 and VB409 come from the T-09 functions. */
export class DbError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "DbError";
  }
}

/** HTTP status for a database failure: the T-09 functions' VB4xx codes, else 500. */
export function dbErrorStatus(error: unknown): number {
  if (error instanceof DbError && error.code && /^VB(400|404|409)$/.test(error.code)) return Number(error.code.slice(2));
  return 500;
}

function client(env: Env): SupabaseClient {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new DbError("the database is not configured", null);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "cache-control": "no-store" } },
  });
}

async function rpc<T>(db: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new DbError(error.message, error.code ?? null);
  return data as T;
}

const counts = (rows: Array<{ n: number } & Record<string, unknown>>, key: string) =>
  Object.fromEntries(rows.map((r) => [String(r[key]), Number(r.n)]));

/** The service-role database. The client is created on first use, so missing env fails that call (500). */
export function serviceDb(env: Env = process.env): ServiceDb {
  let cached: SupabaseClient | undefined;
  const db = (): SupabaseClient => (cached ??= client(env));
  return {
    async statusCounts(scope, scopeId) {
      return counts(await rpc(db(), "official_status_counts", { p_scope: scope, p_scope_id: scopeId }), "status");
    },
    batchBallots(scope, scopeId, from) {
      return rpc(db(), "official_batch_ballots", { p_scope: scope, p_scope_id: scopeId, p_from: from });
    },
    async machineBallotCounts(precinctId) {
      return counts(await rpc(db(), "official_machine_ballot_counts", { p_precinct: precinctId }), "machine_id");
    },
    async precinctMachines(precinctId) {
      const { data, error } = await db().from("machines").select("id").eq("precinct_id", precinctId).retry(false);
      if (error) throw new DbError(error.message, error.code ?? null);
      return (data as Array<{ id: string }>).map((r) => r.id);
    },
    stageTotals(scope, scopeId, stage) {
      return rpc(db(), "official_stage_totals", { p_scope: scope, p_scope_id: scopeId, p_stage: stage });
    },
    async challengeRemoved(countyId) {
      const rows = await rpc<Array<{ ciphertext: string }>>(db(), "official_challenge_removed", { p_county: countyId });
      return rows.map((r) => r.ciphertext);
    },
    recordUploads(uploads, actorId) {
      return rpc(db(), "official_record_uploads", { p_uploads: uploads, p_actor: actorId });
    },
    runBatch(a) {
      return rpc(db(), "official_run_batch", {
        p_scope: a.scope,
        p_scope_id: a.scopeId,
        p_from: a.from,
        p_to: a.to,
        p_actor_role: a.actorRole,
        p_actor_id: a.actorId,
        p_advance: a.advance,
        p_challenge: a.challenge,
        p_stage_record: a.stageRecord,
        p_uploads: a.uploads,
      });
    },
    async ballotScope(ballotId) {
      const rows = await rpc<BallotScope[]>(db(), "official_ballot_scope", { p_ballot: ballotId });
      return rows[0] ?? null;
    },
    resolveChallenge(ballotId, to, reason, actorRole, actorId) {
      return rpc(db(), "official_resolve_challenge", {
        p_ballot: ballotId,
        p_to: to,
        p_reason: reason,
        p_actor_role: actorRole,
        p_actor_id: actorId,
      });
    },
    mismatches(scope, scopeId) {
      return rpc(db(), "official_mismatches", { p_scope: scope, p_scope_id: scopeId });
    },
  };
}
