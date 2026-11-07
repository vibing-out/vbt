// Plain-language wording for the public /record page (voter mode: short sentences, no jargon without
// a plain explanation). Dates only, never a time of day or a sequence.

export const REPO_URL = "https://github.com/vibing-out/vbt";
/** The record format reference (T-15a, #150). */
export const RECORD_FORMAT_URL = `${REPO_URL}/blob/main/docs/record-format.md`;
/** The independent verifier (T-15). */
export const VERIFIER_URL = `${REPO_URL}/tree/main/tools/verifier`;

export const RECORD_INTRO =
  "Each stage of the count publishes a signed record: the tracking codes it includes, a fingerprint of every encrypted ballot, the totals and a digital signature. No record shows how anyone voted.";

export const NO_RECORDS = "No records are published yet. Records appear here as each stage of the count is published.";

export const RECORDS_UNAVAILABLE = "The published records couldn't be loaded. Try again later.";

export const MERKLE_ROOT_HINT = "One fingerprint that covers every encrypted ballot in this record.";

export const SIGNATURE_HINT = "The election office's digital signature over this record.";
