// Tracking-code normalisation and format check for the public tracker (T-08).
//
// No locked code format exists yet (T-21 owns tracking codes), so the pattern is deliberately permissive:
// one to eight groups of 1-12 upper-case letters or digits joined by "-", at most 64 characters. It
// matches the seeded codes (SEED-0001) and the receipt mockup (RIVER-MAPLE-7Q4K-HAWK). Anything else is
// rejected before a database call, which also keeps PostgREST filter syntax (",()*." and quotes) out of
// every query.

export const MAX_CODE_LENGTH = 64;
const CODE_PATTERN = /^[A-Z0-9]{1,12}(?:-[A-Z0-9]{1,12}){0,7}$/;
// Generous cap on the raw input, so normalising a huge string costs nothing.
const MAX_RAW_LENGTH = 256;

/** Trim, upper-case, and turn runs of whitespace into a single "-". */
export function normaliseCode(raw: string): string {
  if (raw.length > MAX_RAW_LENGTH) return "";
  return raw.trim().toUpperCase().replace(/\s+/g, "-");
}

/** True when an already-normalised code has the accepted shape. */
export function isWellFormedCode(code: string): boolean {
  return code.length <= MAX_CODE_LENGTH && CODE_PATTERN.test(code);
}
