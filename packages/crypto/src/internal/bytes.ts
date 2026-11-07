import { createHash } from "node:crypto";

export const HASH_BYTES = 32;

export function sha256(...parts: readonly Uint8Array[]): Uint8Array {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function assertBytes(value: unknown, name: string, length?: number): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${name} must be a Uint8Array`);
  if (length !== undefined && value.length !== length) {
    throw new RangeError(`${name} must be ${length} bytes, got ${value.length}`);
  }
}
