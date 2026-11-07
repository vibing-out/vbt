// The encrypted ballot record an official uploads to POST /api/events (T-05 C2): one file per
// upload, exported from the voting system (or the simulator, T-06) after polls close. Nothing in it
// is ever plaintext: each ballot is a sealed-box ciphertext with its tracking code. The server never
// encrypts; it checks each code against its ciphertext and stores the record.
//
// {
//   "format": "vbt-ballot-record", "version": 1,
//   "election_id": "...", "county_id": "...",
//   "ballots": [{ "tracking_code": "...", "prev_tracking_code": "..." | null,
//                 "ciphertext": "<standard base64>", "ballot_style": "...",
//                 "precinct_id": "...", "machine_id": "...", "cast_date": "YYYY-MM-DD" }]
// }
//
// Only the date of casting is in the file, never a time (locked principle 5). Unknown fields are
// refused, so a later version must change `version`.

import { isIsoDate } from "./date.ts";
import { sha256Hex } from "./hash.ts";

export const RECORD_FILE_FORMAT = "vbt-ballot-record";
export const RECORD_FILE_VERSION = 1;
/** private.ingest_files.kind for this file. */
export const RECORD_FILE_KIND = "ballot_record";

export type RecordFileBallot = {
  tracking_code: string;
  prev_tracking_code: string | null;
  /** Standard base64 (RFC 4648 §4, padded) of the sealed-box bytes. */
  ciphertext: string;
  ballot_style: string;
  precinct_id: string;
  machine_id: string;
  cast_date: string;
};

export type BallotRecordFile = {
  format: typeof RECORD_FILE_FORMAT;
  version: typeof RECORD_FILE_VERSION;
  election_id: string;
  county_id: string;
  ballots: RecordFileBallot[];
};

export type DecodedBallot = RecordFileBallot & {
  ciphertext_bytes: Uint8Array;
  /** Lowercase hex SHA-256 of ciphertext_bytes. */
  ciphertext_hash: string;
};

export type RecordFileErrorCode =
  | "INVALID_JSON"
  | "INVALID_FORMAT"
  | "EMPTY_FILE"
  | "INVALID_CIPHERTEXT"
  | "INVALID_CAST_DATE"
  | "DUPLICATE_TRACKING_CODE";

export type RecordFileResult<T> = { ok: true; value: T } | { ok: false; code: RecordFileErrorCode; message: string };

const MAX_ID = 128;
const FILE_KEYS = ["format", "version", "election_id", "county_id", "ballots"];
const BALLOT_KEYS = ["tracking_code", "prev_tracking_code", "ciphertext", "ballot_style", "precinct_id", "machine_id", "cast_date"];
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const fail = <T>(code: RecordFileErrorCode, message: string): RecordFileResult<T> => ({ ok: false, code, message });

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= MAX_ID;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}

/**
 * Parses the file's bytes and checks its shape: UTF-8 JSON, this format and version, string ids,
 * and every ballot with exactly the v1 fields. Does not decode ciphertexts (decodeRecordBallots).
 */
export function parseRecordFile(bytes: Uint8Array): RecordFileResult<BallotRecordFile> {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail("INVALID_JSON", "the file is not UTF-8 JSON");
  }
  if (!isPlainObject(json) || !hasOnlyKeys(json, FILE_KEYS)) {
    return fail("INVALID_FORMAT", `the file must hold exactly ${FILE_KEYS.join(", ")}`);
  }
  if (json.format !== RECORD_FILE_FORMAT || json.version !== RECORD_FILE_VERSION) {
    return fail("INVALID_FORMAT", `expected format ${RECORD_FILE_FORMAT} version ${RECORD_FILE_VERSION}`);
  }
  if (!isId(json.election_id) || !isId(json.county_id)) return fail("INVALID_FORMAT", "election_id and county_id must be ids");
  if (!Array.isArray(json.ballots)) return fail("INVALID_FORMAT", "ballots must be an array");
  if (json.ballots.length === 0) return fail("EMPTY_FILE", "the file holds no ballots");

  for (const [i, ballot] of (json.ballots as unknown[]).entries()) {
    if (!isPlainObject(ballot) || !hasOnlyKeys(ballot, BALLOT_KEYS)) {
      return fail("INVALID_FORMAT", `ballots[${i}] must hold exactly ${BALLOT_KEYS.join(", ")}`);
    }
    const { tracking_code, prev_tracking_code, ciphertext, ballot_style, precinct_id, machine_id, cast_date } = ballot;
    if (!isId(tracking_code) || !isId(ballot_style) || !isId(precinct_id) || !isId(machine_id)) {
      return fail("INVALID_FORMAT", `ballots[${i}]: tracking_code, ballot_style, precinct_id and machine_id must be ids`);
    }
    if (prev_tracking_code !== null && !isId(prev_tracking_code)) {
      return fail("INVALID_FORMAT", `ballots[${i}]: prev_tracking_code must be an id or null`);
    }
    if (typeof ciphertext !== "string" || typeof cast_date !== "string") {
      return fail("INVALID_FORMAT", `ballots[${i}]: ciphertext and cast_date must be strings`);
    }
  }
  return { ok: true, value: json as BallotRecordFile };
}

/** Standard padded base64 to bytes; null for anything else (URL-safe, unpadded, stray bits). */
export function decodeStandardBase64(text: string): Uint8Array | null {
  if (text === "" || !STANDARD_BASE64.test(text)) return null;
  const bytes = Buffer.from(text, "base64");
  // Re-encoding catches non-zero padding bits, which Buffer silently drops.
  return bytes.toString("base64") === text ? new Uint8Array(bytes) : null;
}

/**
 * Decodes every ciphertext and hashes it (ciphertext_hash = hex SHA-256 of the bytes), checks each
 * cast date, and refuses a tracking code listed twice. All or nothing: the first problem fails the
 * whole file. Messages name the ballot's position, never its contents.
 */
export function decodeRecordBallots(file: BallotRecordFile): RecordFileResult<DecodedBallot[]> {
  const seen = new Set<string>();
  const decoded: DecodedBallot[] = [];
  for (const [i, ballot] of file.ballots.entries()) {
    if (seen.has(ballot.tracking_code)) return fail("DUPLICATE_TRACKING_CODE", `ballots[${i}]: tracking code is listed twice`);
    seen.add(ballot.tracking_code);
    if (!isIsoDate(ballot.cast_date)) return fail("INVALID_CAST_DATE", `ballots[${i}]: cast_date must be YYYY-MM-DD`);
    const bytes = decodeStandardBase64(ballot.ciphertext);
    if (!bytes) return fail("INVALID_CIPHERTEXT", `ballots[${i}]: ciphertext is not standard base64`);
    decoded.push({ ...ballot, ciphertext_bytes: bytes, ciphertext_hash: sha256Hex(bytes) });
  }
  return { ok: true, value: decoded };
}
