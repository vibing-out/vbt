import { describe, expect, test } from "vitest";
import {
  groupMismatchesByPrecinct,
  MISMATCH_REASON,
  mismatchEventPlan,
  mismatchReportScope,
  type MismatchRow,
} from "./mismatch.ts";
import type { BallotStatus } from "./status.ts";

describe("mismatchEventPlan", () => {
  test.each<BallotStatus>(["CAST", "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL"])(
    "from %s: MISMATCH_DETECTED (no statuses) then STATUS_CHANGE to CHALLENGED, both with the reason",
    (from) => {
      expect(mismatchEventPlan(from)).toEqual([
        { eventType: "MISMATCH_DETECTED", from: null, to: null, reason: MISMATCH_REASON },
        { eventType: "STATUS_CHANGE", from, to: "CHALLENGED", reason: MISMATCH_REASON },
      ]);
    },
  );

  test.each<BallotStatus>(["CERTIFIED", "DISCARDED", "SPOILED", "CHALLENGED"])("refuses to flag a %s ballot", (from) => {
    expect(() => mismatchEventPlan(from)).toThrow(/Cannot flag a mismatch: Transition .* -> CHALLENGED is not allowed/);
  });

  test("the public reason holds no ballot detail", () => {
    expect(MISMATCH_REASON).not.toMatch(/\d/);
  });
});

const row = (precinct_id: string, tracking_code: string, extra: Partial<MismatchRow> = {}): MismatchRow => ({
  ballot_id: `id-${tracking_code}`,
  tracking_code,
  cast_date: "2026-11-03",
  current_status: "CHALLENGED",
  precinct_id,
  county_id: precinct_id.slice(0, 5),
  precinct_name: `Name ${precinct_id}`,
  ...extra,
});

describe("groupMismatchesByPrecinct", () => {
  test("groups by precinct, sorted by precinct id then tracking code, with counts and a total", () => {
    const report = groupMismatchesByPrecinct([
      row("P-002", "ZULU-ALPHA-0000-ECHO"),
      row("P-001", "MIKE-ALPHA-0000-ECHO"),
      row("P-002", "ALPHA-ALPHA-0000-ECHO"),
      row("P-001", "BRAVO-ALPHA-0000-ECHO"),
      row("P-002", "MIKE-ALPHA-0000-ECHO"),
    ]);
    expect(report.total).toBe(5);
    expect(report.precincts.map((p) => [p.precinct_id, p.count])).toEqual([
      ["P-001", 2],
      ["P-002", 3],
    ]);
    expect(report.precincts[1]?.ballots.map((b) => b.tracking_code)).toEqual([
      "ALPHA-ALPHA-0000-ECHO",
      "MIKE-ALPHA-0000-ECHO",
      "ZULU-ALPHA-0000-ECHO",
    ]);
    expect(report.precincts[0]).toMatchObject({ county_id: "P-001", name: "Name P-001" });
  });

  test("each ballot carries only id, tracking code, cast date and status", () => {
    const [precinct] = groupMismatchesByPrecinct([row("P-001", "ALPHA-ALPHA-0000-ECHO")]).precincts;
    expect(Object.keys(precinct ?? {}).sort()).toEqual(["ballots", "count", "county_id", "name", "precinct_id"]);
    expect(Object.keys(precinct?.ballots[0] ?? {}).sort()).toEqual(["ballot_id", "cast_date", "current_status", "tracking_code"]);
  });

  test("equal sort keys keep both rows", () => {
    const report = groupMismatchesByPrecinct([row("P-001", "SAME-CODE-0000-ECHO"), row("P-001", "SAME-CODE-0000-ECHO")]);
    expect(report.precincts[0]?.count).toBe(2);
  });

  test("an empty input is an empty report", () => {
    expect(groupMismatchesByPrecinct([])).toEqual({ precincts: [], total: 0 });
  });
});

describe("mismatchReportScope", () => {
  const pollWorker = { role: "poll_worker", scope: "precinct", scopeId: "P-001" } as const;
  const county = { role: "county", scope: "county", scopeId: "C-1" } as const;
  const state = { role: "state", scope: null, scopeId: null } as const;

  test("without a target, each official gets their own scope", () => {
    expect(mismatchReportScope(pollWorker)).toEqual({ scope: "precinct", id: "P-001" });
    expect(mismatchReportScope(county)).toEqual({ scope: "county", id: "C-1" });
    expect(mismatchReportScope(state)).toEqual({ scope: "all" });
  });

  test("a target (already checked against the grant) narrows the report to it", () => {
    expect(mismatchReportScope(county, { scope: "precinct", id: "P-009" })).toEqual({ scope: "precinct", id: "P-009" });
    expect(mismatchReportScope(state, { scope: "county", id: "C-2" })).toEqual({ scope: "county", id: "C-2" });
  });
});
