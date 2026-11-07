import { type MachineLog, parseCdfLog } from "./cdf-log";
import { IngestError } from "./errors";
import { sha256Hex } from "./hash";
import { parseTotalsFile, type TotalsFile, type TotalsScope } from "./totals";

// Uploaded exports (POST /api/events and POST /api/batches). Ingest is file-based and one-way (locked
// principle 7): an official uploads a file exported from the machine or the results system; nothing calls
// a voting system. Formats follow epic/4's simulator output; NIST SP 1500-100 XML and CVR ingest are later.

export { IngestError } from "./errors";
export { sha256Hex } from "./hash";
export type { MachineLog } from "./cdf-log";
export type { TotalsFile } from "./totals";

export const UPLOAD_KINDS = Object.freeze(["machine_log", "precinct_totals", "county_totals", "certified_totals"] as const);
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** Per file, and per request. Vercel caps a function request body at 4.5 MB. */
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_FILES = 20;

/** The scope each kind is uploaded for: machine logs and precinct totals per precinct, the rest per county. */
export const KIND_SCOPE: Readonly<Record<UploadKind, "precinct" | "county">> = Object.freeze({
  machine_log: "precinct",
  precinct_totals: "precinct",
  county_totals: "county",
  certified_totals: "county",
});

const TOTALS_SCOPE: Readonly<Record<Exclude<UploadKind, "machine_log">, TotalsScope>> = Object.freeze({
  precinct_totals: "precinct",
  county_totals: "county-unofficial",
  certified_totals: "county-certified",
});

export function isUploadKind(value: unknown): value is UploadKind {
  return typeof value === "string" && (UPLOAD_KINDS as readonly string[]).includes(value);
}

export type ParsedUpload =
  | { kind: "machine_log"; scopeId: string; sha256: string; log: MachineLog }
  | { kind: Exclude<UploadKind, "machine_log">; scopeId: string; sha256: string; totals: TotalsFile };

/**
 * Parses one uploaded file of `kind` for the precinct or county `scopeId`. Throws IngestError when the
 * file is too large, is not JSON in the expected shape, or is a totals file for another scope.
 */
export function parseUpload(kind: UploadKind, scopeId: string, bytes: Uint8Array): ParsedUpload {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new IngestError(`files may be at most ${MAX_FILE_BYTES} bytes`);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new IngestError("the file is not UTF-8 JSON");
  }
  const sha256 = sha256Hex(bytes);
  if (kind === "machine_log") return { kind, scopeId, sha256, log: parseCdfLog(json) };
  const totals = parseTotalsFile(json);
  if (totals.scope !== TOTALS_SCOPE[kind] || totals.scopeId !== scopeId) {
    throw new IngestError(`expected a ${TOTALS_SCOPE[kind]} totals file for ${scopeId}`);
  }
  return { kind, scopeId, sha256, totals };
}
