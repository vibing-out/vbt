import "server-only";

import { aggregateDecrypt, computeTrackingCode } from "@vbt/crypto";
import { isBallotStatus } from "@vbt/domain";
import {
  type BallotRecordFile,
  buildMismatchEvents,
  castOccurredAt,
  chainEvent,
  type DecodedBallot,
  decodeRecordBallots,
  indianaDate,
  parseRecordFile,
  RECORD_FILE_KIND,
  sha256Hex,
} from "@vbt/events";
import { ELECTION_ID, ELECTION_MANIFEST, loadElectionKeys } from "./election";
import type { Official } from "./require-role";
import { dbFailure, jsonResponse, serverMisconfigured, serviceDb, type ServiceDb, type StoredBallot } from "./service-db";

// POST /api/events (T-05): an official uploads one exported, encrypted ballot record (one-way data
// flow: nothing here ever calls a voting system). The handler order is fixed (C24): size, parse,
// requireRole, then the semantic checks below, then one RPC. Any problem rejects the whole file and
// nothing is written.

/** Vercel's request-body limit is 4.5 MB; refuse anything larger ourselves, with 413. */
export const MAX_UPLOAD_BYTES = 4_500_000;

type Env = Readonly<Record<string, string | undefined>>;

export interface IngestDeps {
  env?: Env;
  fetch?: typeof fetch;
  now?: () => Date;
  db?: ServiceDb | null;
}

export type Upload = { bytes: Uint8Array; file: BallotRecordFile };

const reject = (code: string, error: string) => jsonResponse(422, { error, code });

/**
 * Size and parse (before requireRole, which needs the file's county). 413 over MAX_UPLOAD_BYTES, by
 * content-length and then by the file's size; 400 for a request that is not multipart with one
 * "file" part, or a file that is not JSON; 422 for JSON that is not a v1 ballot record.
 */
export async function readUpload(request: Request): Promise<{ ok: true; upload: Upload } | { ok: false; response: Response }> {
  const tooLarge = () => ({ ok: false as const, response: jsonResponse(413, { error: "file_too_large", max_bytes: MAX_UPLOAD_BYTES }) });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) return tooLarge();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, response: jsonResponse(400, { error: "expected multipart/form-data with one file field" }) };
  }
  const files = form.getAll("file");
  const file = files[0];
  if (files.length !== 1 || !(file instanceof Blob)) {
    return { ok: false, response: jsonResponse(400, { error: "expected exactly one file field" }) };
  }
  if (file.size > MAX_UPLOAD_BYTES) return tooLarge();

  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = parseRecordFile(bytes);
  if (!parsed.ok) {
    return {
      ok: false,
      response:
        parsed.code === "INVALID_JSON" ? jsonResponse(400, { error: parsed.message, code: parsed.code }) : reject(parsed.code, parsed.message),
    };
  }
  return { ok: true, upload: { bytes, file: parsed.value } };
}

/** Checks the ballots against the database's precincts and machines. Null when all are known and consistent. */
async function checkPlaces(db: ServiceDb, file: BallotRecordFile, ballots: readonly DecodedBallot[]): Promise<Response | null> {
  const precincts = new Map((await db.precincts(ballots.map((b) => b.precinct_id))).map((p) => [p.id, p.county_id]));
  const machines = new Map((await db.machines(ballots.map((b) => b.machine_id))).map((m) => [m.id, m.precinct_id]));
  for (const [i, b] of ballots.entries()) {
    const county = precincts.get(b.precinct_id);
    if (county === undefined) return reject("UNKNOWN_PRECINCT", `ballots[${i}]: unknown precinct`);
    if (county !== file.county_id) return reject("PRECINCT_NOT_IN_COUNTY", `ballots[${i}]: precinct is not in county ${file.county_id}`);
    const machinePrecinct = machines.get(b.machine_id);
    if (machinePrecinct === undefined) return reject("UNKNOWN_MACHINE", `ballots[${i}]: unknown machine`);
    if (machinePrecinct !== b.precinct_id) return reject("MACHINE_NOT_IN_PRECINCT", `ballots[${i}]: machine is not in the ballot's precinct`);
  }
  return null;
}

/** The ingest after requireRole: semantic checks, then the one write. */
export async function ingestUpload(upload: Upload, official: Official, deps: IngestDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const keys = loadElectionKeys(env);
  const db = deps.db !== undefined ? deps.db : serviceDb(env, deps.fetch);
  if (!keys || !db) return serverMisconfigured();
  const now = (deps.now ?? (() => new Date()))();
  const { file, bytes } = upload;

  if (file.election_id !== ELECTION_ID) return reject("WRONG_ELECTION", "the file is for another election");

  const decoded = decodeRecordBallots(file);
  if (!decoded.ok) return reject(decoded.code, decoded.message);
  const ballots = decoded.value;

  for (const [i, b] of ballots.entries()) {
    if (computeTrackingCode(b.ciphertext_bytes, b.prev_tracking_code) !== b.tracking_code) {
      return reject("TRACKING_CODE_MISMATCH", `ballots[${i}]: tracking code does not match its ciphertext`);
    }
  }

  try {
    const places = await checkPlaces(db, file, ballots);
    if (places) return places;

    // C7: every ciphertext must open as a ballot of this election. The totals are discarded.
    try {
      await aggregateDecrypt(
        ballots.map((b) => b.ciphertext_bytes),
        keys.electionSecretKey,
        ELECTION_MANIFEST,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "a ciphertext does not open";
      return reject("CIPHERTEXT_INVALID", message);
    }

    const stored = new Map<string, StoredBallot>((await db.chainHeads(ballots.map((b) => b.tracking_code))).map((s) => [s.tracking_code, s]));
    const occurredAt = now.toISOString();
    const occurredOn = indianaDate(now);
    const newBallots = [];
    const mismatches = [];
    for (const b of ballots) {
      const existing = stored.get(b.tracking_code);
      if (!existing) {
        const cast = chainEvent(
          { tracking_code: b.tracking_code, event_type: "CAST", from_status: null, to_status: null, reason: null, occurred_on: b.cast_date },
          null,
        );
        newBallots.push({
          tracking_code: b.tracking_code,
          prev_tracking_code: b.prev_tracking_code,
          ciphertext: Buffer.from(b.ciphertext_bytes).toString("base64"),
          ciphertext_hash: b.ciphertext_hash,
          ballot_style: b.ballot_style,
          precinct_id: b.precinct_id,
          machine_id: b.machine_id,
          cast_date: b.cast_date,
          occurred_at: castOccurredAt(b.cast_date),
          actor_role: "machine",
          actor_id: b.machine_id,
          hash: cast.hash,
        });
        continue;
      }
      // The same record again: nothing to add.
      if (existing.ciphertext_hash === b.ciphertext_hash) continue;
      // C18: the records disagree. The stored ciphertext stays; the ballot is flagged.
      if (existing.heads !== 1 || !isBallotStatus(existing.current_status)) {
        return jsonResponse(409, { error: "conflict", message: "a stored ballot's chain is not a single chain" });
      }
      const plan = buildMismatchEvents({
        tracking_code: b.tracking_code,
        current_status: existing.current_status,
        head_hash: existing.head_hash,
        occurred_on: occurredOn,
      });
      mismatches.push({
        tracking_code: b.tracking_code,
        ciphertext_hash: b.ciphertext_hash,
        expected_status: existing.current_status,
        new_status: plan.new_status,
        events: plan.events.map((e) => ({ ...e, occurred_at: occurredAt, actor_role: official.role, actor_id: official.userId })),
      });
    }

    const result = await db.ingestBallotRecord({
      sha256: sha256Hex(bytes),
      kind: RECORD_FILE_KIND,
      actor_id: official.userId,
      county_id: file.county_id,
      ballot_count: ballots.length,
      ballots: newBallots,
      mismatches,
    });
    return jsonResponse(201, { file_id: result.file_id, event_ids: result.event_ids });
  } catch (error) {
    return dbFailure(error);
  }
}
