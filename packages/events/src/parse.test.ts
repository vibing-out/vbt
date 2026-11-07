import { expect, test } from "vitest";
import { MAX_IMPORT_BYTES, parseJson, Problems, sizeError, utf8ByteLength } from "./parse.ts";

test("utf8ByteLength counts 1-, 2-, 3- and 4-byte characters, and a lone surrogate as 3", () => {
  expect(utf8ByteLength("a")).toBe(1);
  expect(utf8ByteLength("é")).toBe(2);
  expect(utf8ByteLength("€")).toBe(3);
  expect(utf8ByteLength("😀")).toBe(4);
  expect(utf8ByteLength("\ud83d")).toBe(3);
});

test("sizeError refuses more than MAX_IMPORT_BYTES, counting UTF-8 bytes", () => {
  expect(sizeError("x".repeat(MAX_IMPORT_BYTES))).toBeUndefined();
  expect(sizeError("x".repeat(MAX_IMPORT_BYTES + 1))).toMatchObject({ ok: false });
  // Under the limit in UTF-16 units, over it in bytes.
  expect(sizeError("€".repeat(MAX_IMPORT_BYTES / 2))).toMatchObject({ ok: false });
  expect(sizeError("€".repeat(MAX_IMPORT_BYTES / 4))).toBeUndefined();
});

test("parseJson reports non-JSON and oversized text without echoing it", () => {
  expect(parseJson("{")).toEqual({ ok: false, errors: ["$: expected JSON"] });
  expect(parseJson(" ".repeat(MAX_IMPORT_BYTES + 1))).toMatchObject({ ok: false });
  expect(parseJson("[1]")).toEqual({ ok: true, value: [1] });
});

test("Problems names the path, never the value", () => {
  const p = new Problems();
  p.count(-1, "$.n");
  p.object([], "$.o");
  expect(p.done(null)).toEqual({ ok: false, errors: ["$.n: expected a non-negative integer", "$.o: expected an object"] });
});
