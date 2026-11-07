// Public surface of @vbt/events: the event schema, the per-ballot hash chain, stage-record Merkle
// leaves, the uploaded ballot-record format and mismatch events. No I/O and no @vbt/crypto.
export { canonicalJson } from "./canonical.ts";
export { hexToBytes, isSha256Hex, SHA256_HEX, sha256Hex } from "./hash.ts";
export { castOccurredAt, INDIANA_TIME_ZONE, indianaDate, isIsoDate } from "./date.ts";
export {
  ACTOR_ROLES,
  type ActorRole,
  CHAIN_VERSION,
  type ChainCheck,
  type ChainedEvent,
  chainEvent,
  type ChainFields,
  chainHead,
  EVENT_TYPES,
  type EventType,
  eventHashInput,
  hashEvent,
  orderChain,
  verifyChain,
} from "./chain.ts";
export { type LeafSource, sortStageLeaves, stageLeaf, stageLeaves } from "./leaf.ts";
export {
  type BallotRecordFile,
  type DecodedBallot,
  decodeRecordBallots,
  decodeStandardBase64,
  parseRecordFile,
  RECORD_FILE_FORMAT,
  RECORD_FILE_KIND,
  RECORD_FILE_VERSION,
  type RecordFileBallot,
  type RecordFileErrorCode,
  type RecordFileResult,
} from "./record-file.ts";
export { buildMismatchEvents, MISMATCH_REASON, type MismatchInput, type MismatchPlan } from "./mismatch.ts";

// T-10: NIST SP 1500-101 machine logs and SP 1500-100 results, for the cross-checks.
export { isEventType } from "./event-types.ts";

export { lookupNistCode, NIST_CODES, type NistCode, type NistCodeUse } from "./nist-codes.ts";

export { type ImportResult, MAX_IMPORT_BYTES } from "./parse.ts";

export {
  DISPOSITIONS,
  type Disposition,
  LOG_FORMATS,
  type LogFormat,
  type MachineLogEvent,
  type MachineLogImport,
  type MachineLogSummary,
} from "./cdf-log.ts";

export { importCdfLogJson } from "./cdf-log-json.ts";

export { CDF_LOG_NAMESPACE, importCdfLogXml } from "./cdf-log-xml.ts";

export {
  importElectionReport,
  importElectionReportText,
  type OfficialResult,
  RESULTS_STAGE_RULES,
  type ResultsLevel,
  type ResultsStage,
  type ResultsStatus,
  toCheckRecords,
  type Totals,
} from "./results-1500-100.ts";
