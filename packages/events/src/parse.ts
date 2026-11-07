// Small helpers for reading untrusted exports. Errors name a path and what was expected, never the value
// found, so an error message can never echo file contents (a log line or vote count).

export type ImportResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: string[] };

export type Json = Record<string, unknown>;

/** Every importer refuses a file larger than this (UTF-8 bytes). */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** UTF-8 length of a string, without needing Node's Buffer or the DOM's TextEncoder. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit < 0xdc00 && i + 1 < text.length) {
      bytes += 4; // a surrogate pair is one 4-byte code point
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** An error when the file is over MAX_IMPORT_BYTES, else undefined. */
export function sizeError(text: string): ImportResult<never> | undefined {
  // Every UTF-16 unit is at least one byte and at most three, so most files skip the exact count.
  const tooBig = text.length > MAX_IMPORT_BYTES || (text.length * 3 > MAX_IMPORT_BYTES && utf8ByteLength(text) > MAX_IMPORT_BYTES);
  return tooBig ? { ok: false, errors: [`$: expected a file of at most ${MAX_IMPORT_BYTES} bytes`] } : undefined;
}

export class Problems {
  readonly errors: string[] = [];

  add(path: string, expected: string): undefined {
    this.errors.push(`${path}: expected ${expected}`);
    return undefined;
  }

  object(value: unknown, path: string, type?: string): Json | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return this.add(path, "an object");
    const obj = value as Json;
    if (type !== undefined && obj["@type"] !== type) return this.add(`${path}.@type`, `"${type}"`);
    return obj;
  }

  /** An array; a missing value is an empty array when `optional`. */
  array(value: unknown, path: string, optional = false): unknown[] | undefined {
    if (value === undefined && optional) return [];
    if (!Array.isArray(value)) return this.add(path, "an array");
    return value;
  }

  /** A non-empty string. */
  id(value: unknown, path: string): string | undefined {
    if (typeof value !== "string" || value.trim() === "") return this.add(path, "a non-empty string");
    return value;
  }

  count(value: unknown, path: string): number | undefined {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      return this.add(path, "a non-negative integer");
    }
    return value;
  }

  done<T>(value: T): ImportResult<T> {
    return this.errors.length ? { ok: false, errors: this.errors } : { ok: true, value };
  }
}

/** Parses JSON text (after the size cap), or reports why not. */
export function parseJson(text: string): ImportResult<unknown> {
  const tooBig = sizeError(text);
  if (tooBig) return tooBig;
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, errors: ["$: expected JSON"] };
  }
}
