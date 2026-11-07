// NIST SP 1500-100 Election Results Reporting CDF V2, JSON: a precinct's report to the county, the
// county's election-night results or its certified results, as aggregate totals per reporting unit for
// checks C2, C3 and C4. (1500-100 XML is a follow-up.)
// Schema: https://raw.githubusercontent.com/usnistgov/ElectionResultsReporting/version2/NIST_V2_election_results_reporting.json
// Mapping: docs/nist-mapping.md § Official results.

import { type ImportResult, type Json, parseJson, Problems } from "./parse.ts";

/** Aggregate vote totals: contest id -> selection id -> votes (the stage_records.totals shape). */
export type Totals = Readonly<Record<string, Readonly<Record<string, number>>>>;

export type ResultsLevel = "precinct" | "county";
export type ResultsStage = "TALLIED_PRECINCT" | "REPORTED_UNOFFICIAL" | "CERTIFIED";
export type ResultsStatus = "unofficial-complete" | "certified";

/**
 * The stage a report is for, from its ResultsStatus and its level: the widest ReportingUnit type that
 * carries VoteCounts. A precinct cannot certify; every other ResultsStatus (unofficial-partial,
 * recount, correction, pre-election) is refused.
 */
export const RESULTS_STAGE_RULES: readonly { status: ResultsStatus; level: ResultsLevel; stage: ResultsStage }[] = Object.freeze([
  { status: "unofficial-complete", level: "precinct", stage: "TALLIED_PRECINCT" },
  { status: "unofficial-complete", level: "county", stage: "REPORTED_UNOFFICIAL" },
  { status: "certified", level: "county", stage: "CERTIFIED" },
]);

export type OfficialResult = {
  readonly scope: ResultsLevel;
  /** The VBT precinct or county id: the unit's local-level ExternalIdentifier, else its @id. */
  readonly scopeId: string;
  readonly countyId: string;
  /** The report's stage; a county report's precinct rows carry the county's stage. */
  readonly stage: ResultsStage;
  readonly nistStatus: ResultsStatus;
  readonly totals: Totals;
  /** BallotCounts.BallotsCast for the unit, when the report has it. */
  readonly ballotCount: number | null;
};

type Unit = { scope: ResultsLevel; scopeId: string; composing: string[] };

/** The figure for one unit: the `total` count when present (exactly one), else every type but `seats`. */
type Tally = { total: number[]; parts: number };

function localId(p: Problems, unit: Json, path: string, fallback: string): string {
  const list = p.array(unit.ExternalIdentifier, `${path}.ExternalIdentifier`, true) ?? [];
  const index = list.findIndex((x) => typeof x === "object" && x !== null && (x as Json).Type === "local-level");
  if (index < 0) return fallback;
  return p.id((list[index] as Json).Value, `${path}.ExternalIdentifier[${index}].Value`) ?? fallback;
}

/** Adds one VoteCounts or BallotCounts entry to its unit's tally; refuses suppressed counts. */
function addCount(p: Problems, tally: Tally, entry: Json, path: string, field: string): void {
  if (entry.IsSuppressedForPrivacy === true) {
    p.add(`${path}.IsSuppressedForPrivacy`, "counts that are not suppressed (they cannot be verified)");
    return;
  }
  const type = p.id(entry.Type, `${path}.Type`);
  const value = p.count(entry[field], `${path}.${field}`);
  if (type === undefined || value === undefined || type === "seats") return;
  if (type === "total") tally.total.push(value);
  else tally.parts += value;
}

function resolve(p: Problems, tally: Tally, path: string): number {
  if (tally.total.length > 1) p.add(path, "at most one total count per reporting unit");
  return tally.total[0] ?? tally.parts;
}

/** Reads an ElectionReport into one row per precinct or county unit that has vote counts. */
export function importElectionReport(input: unknown): ImportResult<OfficialResult[]> {
  const p = new Problems();
  const report = p.object(input, "$", "ElectionResults.ElectionReport");
  if (!report) return p.done([]);

  const status = report.Status;
  if (!RESULTS_STAGE_RULES.some((r) => r.status === status)) p.add("$.Status", "unofficial-complete or certified");

  // Reporting units, by @id. Only precinct and county units can hold VBT figures.
  const units = new Map<string, Unit>();
  (p.array(report.GpUnit, "$.GpUnit") ?? []).forEach((raw, i) => {
    const path = `$.GpUnit[${i}]`;
    const unit = p.object(raw, path);
    if (!unit) return;
    const ref = p.id(unit["@id"], `${path}.@id`);
    if (ref === undefined) return;
    if (units.has(ref)) p.add(`${path}.@id`, "an @id not already in this report");
    if (unit.Type !== "precinct" && unit.Type !== "county") return;
    if (unit["@type"] !== "ElectionResults.ReportingUnit") p.add(`${path}.@type`, '"ElectionResults.ReportingUnit"');
    const composing = (p.array(unit.ComposingGpUnitIds, `${path}.ComposingGpUnitIds`, true) ?? []).filter(
      (c): c is string => typeof c === "string",
    );
    units.set(ref, { scope: unit.Type, scopeId: localId(p, unit, path, ref), composing });
  });

  // The county of each unit, through the county's ComposingGpUnitIds.
  const countyOf = new Map<string, string>();
  for (const [ref, unit] of units) {
    if (unit.scope !== "county") continue;
    countyOf.set(ref, unit.scopeId);
    for (const child of unit.composing) {
      if (units.get(child)?.scope !== "precinct") continue;
      if (countyOf.has(child)) p.add(`$.GpUnit[@id=${child}]`, "a precinct in only one county");
      countyOf.set(child, unit.scopeId);
    }
  }

  // Tallies per unit, contest and selection.
  const votes = new Map<string, Map<string, Map<string, Tally>>>();
  const ballots = new Map<string, Tally>();
  const tallyFor = (ref: string, path: string): boolean => {
    if (units.has(ref)) return true;
    p.add(path, "the @id of a precinct or county GpUnit");
    return false;
  };
  const elections = p.array(report.Election, "$.Election") ?? [];
  if (elections.length !== 1) p.add("$.Election", "exactly one Election");
  const election = elections.length === 1 ? p.object(elections[0], "$.Election[0]", "ElectionResults.Election") : undefined;

  (p.array(election?.BallotCounts, "$.Election[0].BallotCounts", true) ?? []).forEach((raw, b) => {
    const path = `$.Election[0].BallotCounts[${b}]`;
    const entry = p.object(raw, path, "ElectionResults.BallotCounts");
    if (!entry) return;
    const ref = p.id(entry.GpUnitId, `${path}.GpUnitId`);
    if (ref === undefined || !tallyFor(ref, `${path}.GpUnitId`)) return;
    if (!ballots.has(ref)) ballots.set(ref, { total: [], parts: 0 });
    addCount(p, ballots.get(ref)!, entry, path, "BallotsCast");
  });

  (p.array(election?.Contest, "$.Election[0].Contest", true) ?? []).forEach((rawContest, c) => {
    const cPath = `$.Election[0].Contest[${c}]`;
    const contest = p.object(rawContest, cPath);
    const contestId = p.id(contest?.["@id"], `${cPath}.@id`);
    (p.array(contest?.ContestSelection, `${cPath}.ContestSelection`, true) ?? []).forEach((rawSel, s) => {
      const sPath = `${cPath}.ContestSelection[${s}]`;
      const selection = p.object(rawSel, sPath);
      const selectionId = p.id(selection?.["@id"], `${sPath}.@id`);
      (p.array(selection?.VoteCounts, `${sPath}.VoteCounts`, true) ?? []).forEach((rawCount, v) => {
        const vPath = `${sPath}.VoteCounts[${v}]`;
        const entry = p.object(rawCount, vPath, "ElectionResults.VoteCounts");
        if (!entry) return;
        const ref = p.id(entry.GpUnitId, `${vPath}.GpUnitId`);
        if (ref === undefined || contestId === undefined || selectionId === undefined) return;
        if (!tallyFor(ref, `${vPath}.GpUnitId`)) return;
        const byContest = votes.get(ref) ?? new Map<string, Map<string, Tally>>();
        votes.set(ref, byContest);
        const bySelection = byContest.get(contestId) ?? new Map<string, Tally>();
        byContest.set(contestId, bySelection);
        const tally = bySelection.get(selectionId) ?? { total: [], parts: 0 };
        bySelection.set(selectionId, tally);
        addCount(p, tally, entry, vPath, "Count");
      });
    });
  });

  // The report's level is the widest unit with vote counts; that and the status give the stage.
  const level: ResultsLevel = [...votes.keys()].some((ref) => units.get(ref)!.scope === "county") ? "county" : "precinct";
  const rule = RESULTS_STAGE_RULES.find((r) => r.status === status && r.level === level);
  if (votes.size === 0 && p.errors.length === 0) p.add("$.Election[0].Contest", "VoteCounts for a precinct or county");
  else if (status === "certified" && !rule) p.add("$.Status", "certified results from a county, not a precinct");

  const rows: OfficialResult[] = [];
  for (const [ref, byContest] of votes) {
    const unit = units.get(ref)!;
    const countyId = countyOf.get(ref);
    if (countyId === undefined) {
      p.add(`$.GpUnit[@id=${ref}]`, "a precinct inside a county (ComposingGpUnitIds)");
      continue;
    }
    const totals: Record<string, Record<string, number>> = {};
    for (const [contestId, bySelection] of byContest) {
      totals[contestId] = {};
      for (const [selectionId, tally] of bySelection) totals[contestId][selectionId] = resolve(p, tally, `$.GpUnit[@id=${ref}]`);
    }
    const ballotTally = ballots.get(ref);
    const ballotCount = ballotTally ? resolve(p, ballotTally, `$.GpUnit[@id=${ref}]`) : null;
    if (rule) rows.push({ scope: unit.scope, scopeId: unit.scopeId, countyId, stage: rule.stage, nistStatus: rule.status, totals, ballotCount });
  }
  rows.sort((a, b) => a.scope.localeCompare(b.scope) || a.scopeId.localeCompare(b.scopeId));
  return p.done(rows);
}

/** importElectionReport over the uploaded file's text (at most MAX_IMPORT_BYTES). */
export function importElectionReportText(text: string): ImportResult<OfficialResult[]> {
  const parsed = parseJson(text);
  return parsed.ok ? importElectionReport(parsed.value) : parsed;
}

type PrecinctRecord = { precinctId: string; countyId: string; totals: Totals };
type CountyRecord = { countyId: string; totals: Totals; ballotCount?: number };

/**
 * Splits imported rows into the records the cross-checks compare (structurally @vbt/domain's
 * CrossCheckInput fields): precinct reports to the county (C2, C3), the county's election-night totals
 * (C3, C4) and their precinct breakdown (C3), and certified county totals (C4). Certified precinct rows
 * are not compared by any check.
 */
export function toCheckRecords(rows: readonly OfficialResult[]): {
  precinctReports: PrecinctRecord[];
  electionNight: CountyRecord[];
  electionNightPrecincts: PrecinctRecord[];
  certified: CountyRecord[];
} {
  const precinct = (r: OfficialResult): PrecinctRecord => ({ precinctId: r.scopeId, countyId: r.countyId, totals: r.totals });
  const county = (r: OfficialResult): CountyRecord => ({
    countyId: r.scopeId,
    totals: r.totals,
    ...(r.ballotCount === null ? {} : { ballotCount: r.ballotCount }),
  });
  const at = (stage: ResultsStage, scope: ResultsLevel) => rows.filter((r) => r.stage === stage && r.scope === scope);
  return {
    precinctReports: at("TALLIED_PRECINCT", "precinct").map(precinct),
    electionNight: at("REPORTED_UNOFFICIAL", "county").map(county),
    electionNightPrecincts: at("REPORTED_UNOFFICIAL", "precinct").map(precinct),
    certified: at("CERTIFIED", "county").map(county),
  };
}
