import { expect, test, vi } from "vitest";
import { handleRecordRequest, NOT_PUBLISHED_BODY, UNAVAILABLE_BODY } from "./handler";
import { RecordUnavailableError } from "./read";
import type { PublishedRecord } from "./types";

const RECORD: PublishedRecord = {
  scope: "precinct",
  scope_id: "18097-001",
  stage: "TALLIED_PRECINCT",
  merkle_root: "1".repeat(64),
  ballot_count: 1,
  totals: { mayor: { a: 1 } },
  published_on: "2026-11-03",
  signature: "ab".repeat(64),
  ballots: [{ tracking_code: "RIVER-MAPLE-7Q4K-HAWK", ciphertext_hash: "2".repeat(64) }],
};

test("a published record is returned as JSON, exactly as read", async () => {
  const read = vi.fn(async () => RECORD);
  const response = await handleRecordRequest("18097-001", "TALLIED_PRECINCT", { read });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/application\/json/);
  expect(await response.text()).toBe(JSON.stringify(RECORD));
  expect(read).toHaveBeenCalledWith("18097-001", "TALLIED_PRECINCT");
});

test("not published, unknown stage and unsafe scope ids are one 404 that never echoes the request", async () => {
  const read = vi.fn(async () => null);
  for (const [scope, stage] of [
    ["18097-002", "TALLIED_PRECINCT"],
    ["18097", "CAST"],
    ["18097", "certified"],
    ["../secret", "CERTIFIED"],
    ["", "CERTIFIED"],
  ] as const) {
    const response = await handleRecordRequest(scope, stage, { read });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_PUBLISHED_BODY);
  }
  // Only the well-formed request reached the reader.
  expect(read).toHaveBeenCalledTimes(1);
});

test("a failed read is a 503", async () => {
  const response = await handleRecordRequest("18097", "CERTIFIED", {
    read: async () => {
      throw new RecordUnavailableError();
    },
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual(UNAVAILABLE_BODY);
});
