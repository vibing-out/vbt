// Acceptance (T-10): the 1500-100 parser derives the stage from Status and the ReportingUnit type,
// refuses the statuses VBT cannot check, prefers `total` VoteCounts, refuses suppressed counts and keys
// totals per GpUnit.
import { describe, expect, test } from "vitest";
import { MAX_IMPORT_BYTES } from "./parse.ts";
import { importElectionReport, importElectionReportText, type OfficialResult, RESULTS_STAGE_RULES, toCheckRecords } from "./results-1500-100.ts";

type J = Record<string, unknown>;

const unit = (id: string, type: string, extra: J = {}): J => ({
  "@id": id,
  "@type": "ElectionResults.ReportingUnit",
  Type: type,
  ExternalIdentifier: [{ "@type": "ElectionResults.ExternalIdentifier", Type: "local-level", Value: id.toUpperCase() }],
  ...extra,
});
const county = (composing: string[] = ["p1", "p2"]) => unit("k1", "county", { ComposingGpUnitIds: composing });
const votes = (GpUnitId: string, Count: number, Type = "total", extra: J = {}): J => ({ "@type": "ElectionResults.VoteCounts", GpUnitId, Type, Count, ...extra });
const report = (status: string, gpUnits: J[], counts: J[], extra: J = {}): J => ({
  "@type": "ElectionResults.ElectionReport",
  Status: status,
  GpUnit: gpUnits,
  Election: [
    {
      "@type": "ElectionResults.Election",
      Contest: [{ "@id": "mayor", ContestSelection: [{ "@id": "ada", VoteCounts: counts }] }],
      ...extra,
    },
  ],
});
const UNITS = [county(), unit("p1", "precinct"), unit("p2", "precinct"), unit("st", "state")];

const rows = (value: unknown): OfficialResult[] => {
  const result = importElectionReport(value);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.value;
};
const errors = (value: unknown): string[] => {
  const result = importElectionReport(value);
  return result.ok ? [] : result.errors;
};

describe("stage from Status and the reporting unit", () => {
  test("lists exactly three rules", () => {
    expect(RESULTS_STAGE_RULES.map((r) => `${r.level}+${r.status}=${r.stage}`)).toEqual([
      "precinct+unofficial-complete=TALLIED_PRECINCT",
      "county+unofficial-complete=REPORTED_UNOFFICIAL",
      "county+certified=CERTIFIED",
    ]);
  });

  test("a precinct report (only precinct counts) with unofficial-complete is TALLIED_PRECINCT", () => {
    expect(rows(report("unofficial-complete", UNITS, [votes("p1", 7)]))).toEqual([
      { scope: "precinct", scopeId: "P1", countyId: "K1", stage: "TALLIED_PRECINCT", nistStatus: "unofficial-complete", totals: { mayor: { ada: 7 } }, ballotCount: null },
    ]);
  });

  test("a county report with unofficial-complete is REPORTED_UNOFFICIAL, its precinct breakdown too", () => {
    const result = rows(report("unofficial-complete", UNITS, [votes("k1", 9), votes("p1", 7), votes("p2", 2)]));
    expect(result.map((r) => [r.scope, r.scopeId, r.stage])).toEqual([
      ["county", "K1", "REPORTED_UNOFFICIAL"],
      ["precinct", "P1", "REPORTED_UNOFFICIAL"],
      ["precinct", "P2", "REPORTED_UNOFFICIAL"],
    ]);
  });

  test("a county report with certified is CERTIFIED", () => {
    expect(rows(report("certified", UNITS, [votes("k1", 9)])).map((r) => [r.scope, r.stage, r.nistStatus])).toEqual([["county", "CERTIFIED", "certified"]]);
  });

  test("a precinct cannot certify", () => {
    expect(errors(report("certified", UNITS, [votes("p1", 7)]))).toEqual(["$.Status: expected certified results from a county, not a precinct"]);
  });

  test.each(["unofficial-partial", "recount", "correction", "pre-election", "final", undefined])("refuses Status %s", (status) => {
    expect(errors(report(status as string, UNITS, [votes("k1", 9)]))).toEqual(["$.Status: expected unofficial-complete or certified"]);
  });
});

describe("vote counts", () => {
  test("prefer the total count over the other types", () => {
    const counts = [votes("p1", 4, "election-day"), votes("p1", 7), votes("p1", 2, "early")];
    expect(rows(report("unofficial-complete", UNITS, counts))[0]!.totals).toEqual({ mayor: { ada: 7 } });
  });

  test("without a total, sum every type except seats", () => {
    const counts = [votes("p1", 4, "election-day"), votes("p1", 2, "early"), votes("p1", 1, "seats")];
    expect(rows(report("unofficial-complete", UNITS, counts))[0]!.totals).toEqual({ mayor: { ada: 6 } });
  });

  test("refuse counts suppressed for privacy: they cannot be verified", () => {
    expect(errors(report("unofficial-complete", UNITS, [votes("p1", 7, "total", { IsSuppressedForPrivacy: true })]))).toEqual([
      "$.Election[0].Contest[0].ContestSelection[0].VoteCounts[0].IsSuppressedForPrivacy: expected counts that are not suppressed (they cannot be verified)",
    ]);
    expect(rows(report("unofficial-complete", UNITS, [votes("p1", 7, "total", { IsSuppressedForPrivacy: false })]))).toHaveLength(1);
  });

  test("key totals per GpUnit, and every contest and selection under it", () => {
    const value = report("unofficial-complete", UNITS, [votes("p1", 7), votes("p2", 3)]);
    const contest = ((value.Election as J[])[0]!.Contest as J[])[0]!;
    (contest.ContestSelection as J[]).push({ "@id": "bo", VoteCounts: [votes("p1", 1)] });
    ((value.Election as J[])[0]!.Contest as J[]).push({ "@id": "measure", ContestSelection: [{ "@id": "yes", VoteCounts: [votes("p2", 5)] }] });
    expect(Object.fromEntries(rows(value).map((r) => [r.scopeId, r.totals]))).toEqual({
      P1: { mayor: { ada: 7, bo: 1 } },
      P2: { mayor: { ada: 3 }, measure: { yes: 5 } },
    });
  });

  test("refuse two totals for one unit and selection, and bad counts", () => {
    expect(errors(report("unofficial-complete", UNITS, [votes("p1", 7), votes("p1", 8)]))).toEqual([
      "$.GpUnit[@id=p1]: expected at most one total count per reporting unit",
    ]);
    expect(errors(report("unofficial-complete", UNITS, [votes("p1", -1)]))).toEqual([
      "$.Election[0].Contest[0].ContestSelection[0].VoteCounts[0].Count: expected a non-negative integer",
    ]);
    expect(errors(report("unofficial-complete", UNITS, [votes("p1", 7, "")]))).toEqual([
      "$.Election[0].Contest[0].ContestSelection[0].VoteCounts[0].Type: expected a non-empty string",
    ]);
    expect(errors(report("unofficial-complete", UNITS, [{ ...votes("p1", 7), "@type": "x" }]))).toEqual([
      '$.Election[0].Contest[0].ContestSelection[0].VoteCounts[0].@type: expected "ElectionResults.VoteCounts"',
    ]);
  });

  test("refuse counts for a unit that is not a precinct or county in the report", () => {
    expect(errors(report("unofficial-complete", UNITS, [votes("p1", 7), votes("st", 9)]))).toEqual([
      "$.Election[0].Contest[0].ContestSelection[0].VoteCounts[1].GpUnitId: expected the @id of a precinct or county GpUnit",
    ]);
  });

  test("skip counts whose contest or selection has no @id, after reporting it", () => {
    const value = report("unofficial-complete", UNITS, [votes("p1", 7)]);
    ((value.Election as J[])[0]!.Contest as J[]).push({ ContestSelection: [{ "@id": "x", VoteCounts: [votes("p1", 1)] }] });
    expect(errors(value)).toEqual(["$.Election[0].Contest[1].@id: expected a non-empty string"]);
  });

  test("refuse a report with no precinct or county counts", () => {
    expect(errors(report("unofficial-complete", UNITS, []))).toEqual(["$.Election[0].Contest: expected VoteCounts for a precinct or county"]);
  });
});

describe("ballot counts", () => {
  const ballotCounts = (entries: J[]) => ({ BallotCounts: entries });
  const bc = (GpUnitId: string, BallotsCast: number, Type = "total", extra: J = {}) => ({ "@type": "ElectionResults.BallotCounts", GpUnitId, Type, BallotsCast, ...extra });

  test("are read per unit with the same total-first rule", () => {
    const value = report("certified", UNITS, [votes("k1", 9)], ballotCounts([bc("k1", 3, "early"), bc("k1", 10)]));
    expect(rows(value)[0]!.ballotCount).toBe(10);
    const summed = report("certified", UNITS, [votes("k1", 9)], ballotCounts([bc("k1", 3, "early"), bc("k1", 4, "election-day")]));
    expect(rows(summed)[0]!.ballotCount).toBe(7);
  });

  test("refuse suppressed or misplaced ballot counts", () => {
    expect(errors(report("certified", UNITS, [votes("k1", 9)], ballotCounts([bc("k1", 3, "total", { IsSuppressedForPrivacy: true })])))).toHaveLength(1);
    expect(errors(report("certified", UNITS, [votes("k1", 9)], ballotCounts([bc("zz", 3)])))).toEqual([
      "$.Election[0].BallotCounts[0].GpUnitId: expected the @id of a precinct or county GpUnit",
    ]);
    expect(errors(report("certified", UNITS, [votes("k1", 9)], ballotCounts([{ GpUnitId: "k1" }])))).toEqual([
      '$.Election[0].BallotCounts[0].@type: expected "ElectionResults.BallotCounts"',
    ]);
    expect(errors(report("certified", UNITS, [votes("k1", 9)], ballotCounts([{ ...bc("k1", 1), GpUnitId: 3 }])))).toEqual([
      "$.Election[0].BallotCounts[0].GpUnitId: expected a non-empty string",
    ]);
  });
});

describe("reporting units", () => {
  test("use the local-level ExternalIdentifier, else the @id", () => {
    const units = [county(["p1"]), unit("p1", "precinct", { ExternalIdentifier: [{ Type: "fips", Value: "x" }] })];
    expect(rows(report("unofficial-complete", units, [votes("p1", 1)]))[0]).toMatchObject({ scopeId: "p1", countyId: "K1" });
    const bare = [county(["p1"]), unit("p1", "precinct", { ExternalIdentifier: undefined })];
    expect(rows(report("unofficial-complete", bare, [votes("p1", 1)]))[0]!.scopeId).toBe("p1");
  });

  test("refuse a precinct outside any county, or inside two", () => {
    expect(errors(report("unofficial-complete", [unit("p1", "precinct")], [votes("p1", 1)]))).toEqual([
      "$.GpUnit[@id=p1]: expected a precinct inside a county (ComposingGpUnitIds)",
    ]);
    const two = [county(["p1"]), unit("k2", "county", { ComposingGpUnitIds: ["p1", "st", "nope", 4] }), unit("p1", "precinct"), unit("st", "state")];
    expect(errors(report("unofficial-complete", two, [votes("p1", 1)]))).toEqual(["$.GpUnit[@id=p1]: expected a precinct in only one county"]);
  });

  test("refuse a repeated @id, a bad unit and a bad local id", () => {
    expect(errors(report("unofficial-complete", [...UNITS, unit("p1", "precinct")], [votes("p1", 1)]))).toEqual([
      "$.GpUnit[4].@id: expected an @id not already in this report",
    ]);
    expect(errors(report("unofficial-complete", [...UNITS, "x" as unknown as J], [votes("p1", 1)]))).toEqual([
      "$.GpUnit[4]: expected an object",
    ]);
    expect(errors(report("unofficial-complete", [...UNITS, { Type: "precinct" }], [votes("p1", 1)]))).toEqual([
      "$.GpUnit[4].@id: expected a non-empty string",
    ]);
    expect(errors(report("unofficial-complete", [...UNITS, { ...unit("p3", "precinct"), "@type": "x" }], [votes("p1", 1)]))).toEqual([
      '$.GpUnit[4].@type: expected "ElectionResults.ReportingUnit"',
    ]);
    const badLocal = unit("p9", "precinct", { ExternalIdentifier: [{ Type: "local-level", Value: "" }] });
    expect(errors(report("unofficial-complete", [...UNITS, badLocal], [votes("p1", 1)]))).toEqual([
      "$.GpUnit[4].ExternalIdentifier[0].Value: expected a non-empty string",
    ]);
  });
});

describe("report shape", () => {
  test("refuse a wrong @type, a missing GpUnit list and anything but exactly one Election", () => {
    expect(errors({ "@type": "ElectionResults.Election" })).toEqual(['$.@type: expected "ElectionResults.ElectionReport"']);
    expect(errors({ ...report("unofficial-complete", UNITS, [votes("p1", 1)]), GpUnit: undefined })).toContain("$.GpUnit: expected an array");
    expect(errors({ ...report("unofficial-complete", UNITS, [votes("p1", 1)]), Election: [] })).toContain("$.Election: expected exactly one Election");
    const two = report("unofficial-complete", UNITS, [votes("p1", 1)]);
    expect(errors({ ...two, Election: [...(two.Election as J[]), ...(two.Election as J[])] })).toContain("$.Election: expected exactly one Election");
  });

  test("refuse lists that are not arrays, at every level", () => {
    const base = () => report("unofficial-complete", UNITS, [votes("p1", 1)]);
    const election = (value: J) => (value.Election as J[])[0]!;
    const withElection = (patch: J) => {
      const value = base();
      Object.assign(election(value), patch);
      return value;
    };
    expect(errors(withElection({ BallotCounts: "x" }))).toEqual(["$.Election[0].BallotCounts: expected an array"]);
    expect(errors(withElection({ Contest: "x" }))).toEqual(["$.Election[0].Contest: expected an array"]);
    expect(errors(withElection({ Contest: [{ "@id": "mayor", ContestSelection: "x" }] }))).toEqual([
      "$.Election[0].Contest[0].ContestSelection: expected an array",
    ]);
    expect(errors(withElection({ Contest: [{ "@id": "mayor", ContestSelection: [{ "@id": "ada", VoteCounts: "x" }] }] }))).toEqual([
      "$.Election[0].Contest[0].ContestSelection[0].VoteCounts: expected an array",
    ]);
    expect(errors({ ...base(), GpUnit: [unit("k1", "county", { ComposingGpUnitIds: "p1" }), unit("p1", "precinct")] })).toEqual([
      "$.GpUnit[0].ComposingGpUnitIds: expected an array",
      "$.GpUnit[@id=p1]: expected a precinct inside a county (ComposingGpUnitIds)",
    ]);
    expect(errors({ ...base(), Election: {} })).toEqual(["$.Election: expected an array", "$.Election: expected exactly one Election"]);
    expect(errors({ ...base(), GpUnit: [county(), unit("p1", "precinct", { ExternalIdentifier: "P1" })] })).toEqual([
      "$.GpUnit[1].ExternalIdentifier: expected an array",
    ]);
  });

  test("read the uploaded text, refusing non-JSON and files over 10 MB", () => {
    expect(importElectionReportText(JSON.stringify(report("unofficial-complete", UNITS, [votes("p1", 1)])))).toMatchObject({ ok: true });
    expect(importElectionReportText("<xml/>")).toEqual({ ok: false, errors: ["$: expected JSON"] });
    expect(importElectionReportText(" ".repeat(MAX_IMPORT_BYTES + 1))).toMatchObject({ ok: false });
  });
});

describe("toCheckRecords", () => {
  test("splits rows into the records each check compares", () => {
    const all = [
      ...rows(report("unofficial-complete", UNITS, [votes("p1", 7)])),
      ...rows(report("unofficial-complete", UNITS, [votes("k1", 7), votes("p1", 7)], { BallotCounts: [{ "@type": "ElectionResults.BallotCounts", GpUnitId: "k1", Type: "total", BallotsCast: 7 }] })),
      ...rows(report("certified", UNITS, [votes("k1", 7), votes("p1", 7)])),
    ];
    expect(toCheckRecords(all)).toEqual({
      precinctReports: [{ precinctId: "P1", countyId: "K1", totals: { mayor: { ada: 7 } } }],
      electionNight: [{ countyId: "K1", totals: { mayor: { ada: 7 } }, ballotCount: 7 }],
      electionNightPrecincts: [{ precinctId: "P1", countyId: "K1", totals: { mayor: { ada: 7 } } }],
      certified: [{ countyId: "K1", totals: { mayor: { ada: 7 } } }],
    });
  });
});
