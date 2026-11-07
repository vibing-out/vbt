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
