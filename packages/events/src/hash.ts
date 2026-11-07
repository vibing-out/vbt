import { createHash } from "node:crypto";

/** Lowercase hex SHA-256 of bytes, or of a string's UTF-8 encoding. */
export function sha256Hex(input: Uint8Array | string): string {
  return createHash("sha256").update(input).digest("hex");
}

export const SHA256_HEX = /^[0-9a-f]{64}$/;

/** True for exactly 64 lowercase hex characters. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

/** The 32 bytes of a lowercase hex SHA-256. Throws on anything else. */
export function hexToBytes(hex: string): Uint8Array {
  if (!isSha256Hex(hex)) throw new TypeError("expected 64 lowercase hex characters");
  return new Uint8Array(Buffer.from(hex, "hex"));
}
