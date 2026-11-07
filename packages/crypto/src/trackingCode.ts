import { assertBytes, sha256, utf8 } from "./internal/bytes.js";
import { TRACKING_WORDLIST } from "./wordlist.js";

/** Crockford Base32 (no I, L, O, U). */
export const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Frozen format: WORD-WORD-XXXX-WORD, e.g. RIVER-MAPLE-7Q4K-HAWK. */
export const TRACKING_CODE_PATTERN = /^[A-Z]{3,8}-[A-Z]{3,8}-[0-9A-HJKMNP-TV-Z]{4}-[A-Z]{3,8}$/;

/**
 * True when `code` has the frozen tracking-code shape. Checks format only,
 * not that the words are in TRACKING_WORDLIST or that the code exists.
 */
export function isTrackingCode(code: unknown): code is string {
  return typeof code === "string" && TRACKING_CODE_PATTERN.test(code);
}

/** Reads bits big-endian (most significant bit of byte 0 first). */
function bitReader(bytes: Uint8Array) {
  let bitPos = 0;
  return (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i++, bitPos++) {
      const byte = bytes[bitPos >> 3] ?? 0;
      value = (value << 1) | ((byte >> (7 - (bitPos & 7))) & 1);
    }
    return value;
  };
}

/**
 * Confirmation code for a ballot, chained to the previous code on the same
 * device: H = SHA-256(ciphertext || 0x00 || UTF-8(prevTrackingCode ?? "")).
 * Bits of H, big-endian: 11 → word, 11 → word, 20 → 4 Crockford chars, 11 → word.
 */
export function computeTrackingCode(ciphertext: Uint8Array, prevTrackingCode: string | null): string {
  assertBytes(ciphertext, "ciphertext");
  if (prevTrackingCode !== null && typeof prevTrackingCode !== "string") {
    throw new TypeError("prevTrackingCode must be a string or null");
  }
  const read = bitReader(sha256(ciphertext, Uint8Array.of(0x00), utf8(prevTrackingCode ?? "")));
  const word = () => TRACKING_WORDLIST[read(11)] as string;
  const first = word();
  const second = word();
  let chars = "";
  for (let i = 0; i < 4; i++) chars += CROCKFORD_BASE32[read(5)];
  const last = word();
  return `${first}-${second}-${chars}-${last}`;
}
