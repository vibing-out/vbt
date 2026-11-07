// Public surface of @vbt/crypto (export lock, T-21). There is deliberately no
// export for decrypting an individual ballot: decryption is aggregate only.
export { ready } from "./ready.js";
export { generateElectionKeyPair, generateSigningKeyPair } from "./keys.js";
export { encryptBallot } from "./sealedBallot.js";
export { computeTrackingCode } from "./trackingCode.js";
export { TRACKING_WORDLIST } from "./wordlist.js";
export { buildMerkleTree, verifyInclusionProof } from "./merkle.js";
export { signStageRecord, verifyStageRecord } from "./stageRecord.js";
export { aggregateDecrypt } from "./aggregate.js";

export type { ElectionManifest, BallotPlaintext, ContestTotals } from "./manifest.js";
export type { StageRecord } from "./stageRecord.js";
export type { InclusionProof, ProofStep } from "./merkle.js";
