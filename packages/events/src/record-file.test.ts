import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { type BallotRecordFile, decodeRecordBallots, decodeStandardBase64, parseRecordFile } from "./record-file.ts";

const bytes = Uint8Array.from([0xfb, 0xff, 0x00, 0x10, 0x20, 0x30, 0x40]);
const ballot = {
  tracking_code: "RIVER-MAPLE-7Q4K-HAWK",
  prev_tracking_code: null,
  ciphertext: Buffer.from(bytes).toString("base64"),
  ballot_style: "style-general",
  precinct_id: "18097-001",
  machine_id: "M-18097-001-A",
  cast_date: "2026-11-03",
};
const file = { format: "vbt-ballot-record", version: 1, election_id: "e", county_id: "18097", ballots: [ballot] };
const encode = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));

describe("parseRecordFile", () => {
  test("accepts a v1 file", () => {
    const result = parseRecordFile(encode(file));
    expect(result).toEqual({ ok: true, value: file });
  });

  test.each([
    ["not JSON", "{", "INVALID_JSON"],
    ["not UTF-8", new Uint8Array([0x7b, 0xff, 0x7d]), "INVALID_JSON"],
    ["an array", [], "INVALID_FORMAT"],
    ["another format", { ...file, format: "cvr" }, "INVALID_FORMAT"],
    ["another version", { ...file, version: 2 }, "INVALID_FORMAT"],
    ["an extra field", { ...file, voter: "x" }, "INVALID_FORMAT"],
    ["a missing county", { ...file, county_id: "" }, "INVALID_FORMAT"],
    ["no ballots array", { ...file, ballots: {} }, "INVALID_FORMAT"],
    ["no ballots", { ...file, ballots: [] }, "EMPTY_FILE"],
    ["a ballot with an extra field (a time)", { ...file, ballots: [{ ...ballot, cast_at: "08:14" }] }, "INVALID_FORMAT"],
    ["a ballot missing a field", { ...file, ballots: [{ ...ballot, machine_id: undefined }] }, "INVALID_FORMAT"],
    ["a numeric precinct", { ...file, ballots: [{ ...ballot, precinct_id: 1 }] }, "INVALID_FORMAT"],
    ["a bad prev code", { ...file, ballots: [{ ...ballot, prev_tracking_code: "" }] }, "INVALID_FORMAT"],
    ["a numeric ciphertext", { ...file, ballots: [{ ...ballot, ciphertext: 1 }] }, "INVALID_FORMAT"],
  ])("refuses %s", (_name, input, code) => {
    const result = parseRecordFile(input instanceof Uint8Array ? input : encode(input));
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.code).toBe(code);
  });
});

describe("decodeRecordBallots", () => {
  test("decodes ciphertexts and sets ciphertext_hash to hex SHA-256 of the bytes", () => {
    const result = decodeRecordBallots(file as BallotRecordFile);
    if (!result.ok) throw new Error(result.message);
    expect([...result.value[0]!.ciphertext_bytes]).toEqual([...bytes]);
    expect(result.value[0]!.ciphertext_hash).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  test.each([
    ["URL-safe base64", { ciphertext: Buffer.from(bytes).toString("base64url") }, "INVALID_CIPHERTEXT"],
    ["unpadded base64", { ciphertext: "AQI" }, "INVALID_CIPHERTEXT"],
    ["empty ciphertext", { ciphertext: "" }, "INVALID_CIPHERTEXT"],
    ["stray padding bits", { ciphertext: "AQJ=" }, "INVALID_CIPHERTEXT"],
    ["an impossible date", { cast_date: "2026-02-30" }, "INVALID_CAST_DATE"],
    ["a timestamp for a date", { cast_date: "2026-11-03T08:00:00Z" }, "INVALID_CAST_DATE"],
  ])("refuses %s", (_name, change, code) => {
    const result = decodeRecordBallots({ ...file, ballots: [{ ...ballot, ...change }] } as BallotRecordFile);
    expect(result.ok ? null : result.code).toBe(code);
  });

  test("refuses a tracking code listed twice in one file", () => {
    const result = decodeRecordBallots({ ...file, ballots: [ballot, { ...ballot }] } as BallotRecordFile);
    expect(result.ok ? null : result.code).toBe("DUPLICATE_TRACKING_CODE");
  });

  test("error messages name the position, never the contents", () => {
    const result = decodeRecordBallots({ ...file, ballots: [ballot, { ...ballot, tracking_code: "OTHER-CODE", ciphertext: "!!" }] } as BallotRecordFile);
    expect(result.ok ? "" : result.message).toBe("ballots[1]: ciphertext is not standard base64");
  });
});

test("decodeStandardBase64 round-trips", () => {
  expect([...decodeStandardBase64("AQID")!]).toEqual([1, 2, 3]);
  expect(decodeStandardBase64("AQ-_")).toBeNull();
});
