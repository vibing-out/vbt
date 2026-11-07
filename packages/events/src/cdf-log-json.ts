// NIST SP 1500-101 event log, JSON: one machine event log export as an official uploads it after polls
// close. Rules shared with the XML importer live in cdf-log.ts.

import { type MachineLogImport, readEventLog } from "./cdf-log.ts";
import { type ImportResult, parseJson } from "./parse.ts";

/** Imports a 1500-101 JSON log from the uploaded file's text (at most MAX_IMPORT_BYTES). */
export function importCdfLogJson(text: string): ImportResult<MachineLogImport> {
  const parsed = parseJson(text);
  return parsed.ok ? readEventLog(parsed.value, "cdf-json") : parsed;
}
