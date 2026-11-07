import { expect, test } from "vitest";
import { groupByCounty } from "./group";
import { recordAnchor, recordApiUrl, recordFileName, recordPageUrl } from "./links";
import type { RecordSummary } from "./types";

test("record links: the exact API path, the /record anchor and the download file name", () => {
  expect(recordApiUrl("18097-001", "TALLIED_PRECINCT")).toBe("/api/record/18097-001/TALLIED_PRECINCT");
  expect(recordAnchor("18097", "CERTIFIED")).toBe("record-18097-CERTIFIED");
  expect(recordPageUrl("18097", "CERTIFIED")).toBe("/record#record-18097-CERTIFIED");
  expect(recordFileName("18097", "CERTIFIED")).toBe("18097-CERTIFIED.json");
});

test("no record link for a stage that publishes no record or an unsafe scope id", () => {
  expect(recordPageUrl("18097", "CAST")).toBeNull();
  expect(recordPageUrl("18097", "SPOILED")).toBeNull();
  expect(recordPageUrl("Precinct 12", "TALLIED_PRECINCT")).toBeNull();
  expect(recordPageUrl("a/b", "CERTIFIED")).toBeNull();
});

const summary = (scope_id: string, stage: RecordSummary["stage"]): RecordSummary => ({
  scope: stage === "TALLIED_PRECINCT" ? "precinct" : "county",
  scope_id,
  stage,
  merkle_root: "1".repeat(64),
  ballot_count: 1,
  totals: {},
  published_on: "2026-11-03",
  signature: "ab".repeat(64),
});

test("groups by county, then stage order, then scope id; never by publication", () => {
  const groups = groupByCounty([
    { countyId: "18097", record: summary("18097", "CERTIFIED") },
    { countyId: "18057", record: summary("18057-001", "TALLIED_PRECINCT") },
    { countyId: "18097", record: summary("18097-002", "TALLIED_PRECINCT") },
    { countyId: "18097", record: summary("18097", "REPORTED_UNOFFICIAL") },
    { countyId: "18097", record: summary("18097-001", "TALLIED_PRECINCT") },
  ]);
  expect(groups.map((g) => [g.countyId, g.records.map((r) => `${r.scope_id}/${r.stage}`)])).toEqual([
    ["18057", ["18057-001/TALLIED_PRECINCT"]],
    ["18097", ["18097-001/TALLIED_PRECINCT", "18097-002/TALLIED_PRECINCT", "18097/REPORTED_UNOFFICIAL", "18097/CERTIFIED"]],
  ]);
});
