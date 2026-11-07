import { createHash } from "node:crypto";

// File fingerprints for private.uploads (locked API: "file hashes recorded"). This identifies an uploaded
// file; it is not election cryptography, which stays in @vbt/crypto.
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
