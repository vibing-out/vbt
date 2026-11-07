// Test-only helpers for the official route tests: auth headers, multipart bodies and fixture files.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

const FIXTURES = join(import.meta.dirname, "..", "ingest", "__fixtures__");

export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

export function fixtureJson<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

export const jsonBytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

/** A multipart/form-data POST with string fields and files (each [field, bytes]). */
export function multipart(
  url: string,
  fields: Record<string, string>,
  files: Array<[string, Uint8Array]>,
  headers: Record<string, string> = {},
): Request {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  files.forEach(([name, bytes], i) => form.append(name, new Blob([bytes as BlobPart], { type: "application/json" }), `file-${i}.json`));
  return new Request(url, { method: "POST", body: form, headers });
}
