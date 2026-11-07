// Semantic validator for the NIST SP 1500-103 report subset this tool emits
// (one CVR per file). The vendored JSON schema
// (vendor/nist-sp-1500-103/cvr-minimal.schema.json) checks structure in the
// tests. This validator also checks what the schema can't: that ids resolve
// (devices, GpUnits, snapshots, contests, selections) and that a county is
// typed as `other` with `OtherType: "county"`. Returns a list of problems;
// empty means valid.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v !== "";
const isNonEmptyArray = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0;

const REPORTING_UNIT_TYPES = new Set([
  "combined-precinct",
  "other",
  "polling-place",
  "precinct",
  "split-precinct",
  "vote-center",
]);

function expectType(errors: string[], at: string, v: Obj, type: string): void {
  if (v["@type"] !== type) errors.push(`${at}.@type must be "${type}"`);
}

export function validateCvrReport(file: unknown, opts: { perBallot?: boolean } = { perBallot: true }): string[] {
  const errors: string[] = [];
  if (!isObj(file)) return ["root must be a CVR.CastVoteRecordReport object"];
  if ("CastVoteRecordReport" in file) return ["root must be the report itself, not wrapped in { CastVoteRecordReport }"];
  const r = file;
  expectType(errors, "report", r, "CVR.CastVoteRecordReport");
  if ("GPUnit" in r) errors.push("GPUnit is not a NIST property; use GpUnit");

  if (r.Version !== "1.0.0") errors.push('Version must be "1.0.0"');
  if (!isStr(r.GeneratedDate)) errors.push("GeneratedDate must be a non-empty string");

  // Reporting devices, and the ids that must resolve to them.
  const deviceIds = new Set<string>();
  if (!isNonEmptyArray(r.ReportingDevice)) {
    errors.push("ReportingDevice must be a non-empty array");
  } else {
    r.ReportingDevice.forEach((d, i) => {
      if (!isObj(d) || !isStr(d["@id"])) return void errors.push(`ReportingDevice[${i}] needs @id`);
      expectType(errors, `ReportingDevice[${i}]`, d, "CVR.ReportingDevice");
      deviceIds.add(d["@id"]);
    });
  }
  if (!isNonEmptyArray(r.ReportGeneratingDeviceIds) || !r.ReportGeneratingDeviceIds.every(isStr)) {
    errors.push("ReportGeneratingDeviceIds must be a non-empty string array");
  } else {
    for (const id of r.ReportGeneratingDeviceIds) {
      if (!deviceIds.has(id)) errors.push(`ReportGeneratingDeviceIds ${id} is not a declared ReportingDevice`);
    }
  }

  const gpUnitIds = new Set<string>();
  if (!isNonEmptyArray(r.GpUnit)) {
    errors.push("GpUnit must be a non-empty array");
  } else {
    r.GpUnit.forEach((g, i) => {
      const at = `GpUnit[${i}]`;
      if (!isObj(g) || !isStr(g["@id"])) return void errors.push(`${at} needs @id`);
      expectType(errors, at, g, "CVR.GpUnit");
      gpUnitIds.add(g["@id"]);
      if (!isStr(g.Type) || !REPORTING_UNIT_TYPES.has(g.Type)) {
        errors.push(`${at}.Type must be a ReportingUnitType, got ${String(g.Type)}`);
      }
      if (g.Type === "other" && !isStr(g.OtherType)) errors.push(`${at} has Type "other" without OtherType`);
      if (Array.isArray(g.ReportingDeviceIds)) {
        for (const id of g.ReportingDeviceIds) {
          if (!isStr(id) || !deviceIds.has(id)) errors.push(`${at}.ReportingDeviceIds ${String(id)} is not a declared ReportingDevice`);
        }
      }
    });
  }

  // Contest and selection ids declared by the Election, for cross-reference.
  const declared = new Map<string, Set<string>>();
  const electionIds = new Set<string>();
  if (!isNonEmptyArray(r.Election)) {
    errors.push("Election must be a non-empty array");
  } else {
    r.Election.forEach((el, i) => {
      const at = `Election[${i}]`;
      if (!isObj(el) || !isStr(el["@id"]) || !isNonEmptyArray(el.Contest)) {
        return void errors.push(`${at} needs @id and a non-empty Contest array`);
      }
      expectType(errors, at, el, "CVR.Election");
      electionIds.add(el["@id"]);
      if (!isStr(el.ElectionScopeId) || !gpUnitIds.has(el.ElectionScopeId)) {
        errors.push(`${at}.ElectionScopeId must name a GpUnit`);
      }
      const candidateIds = new Set(
        (Array.isArray(el.Candidate) ? el.Candidate : []).filter(isObj).map((c) => c["@id"]).filter(isStr),
      );
      el.Contest.forEach((c, j) => {
        const ct = `${at}.Contest[${j}]`;
        if (!isObj(c) || !isStr(c["@id"]) || !Array.isArray(c.ContestSelection)) {
          return void errors.push(`${ct} needs @id and ContestSelection`);
        }
        const selType =
          c["@type"] === "CVR.CandidateContest"
            ? "CVR.CandidateSelection"
            : c["@type"] === "CVR.BallotMeasureContest"
              ? "CVR.BallotMeasureSelection"
              : undefined;
        if (!selType) errors.push(`${ct}.@type must be "CVR.CandidateContest" or "CVR.BallotMeasureContest"`);
        const ids = new Set<string>();
        c.ContestSelection.forEach((s, k) => {
          const st = `${ct}.ContestSelection[${k}]`;
          if (!isObj(s) || !isStr(s["@id"])) return void errors.push(`${st} needs @id`);
          if (selType) expectType(errors, st, s, selType);
          if (Array.isArray(s.CandidateIds)) {
            for (const id of s.CandidateIds) {
              if (!isStr(id) || !candidateIds.has(id)) errors.push(`${st}.CandidateIds ${String(id)} is not a declared Candidate`);
            }
          }
          ids.add(s["@id"]);
        });
        declared.set(c["@id"], ids);
      });
    });
  }

  if (!Array.isArray(r.CVR)) return [...errors, "CVR must be an array"];
  if (opts.perBallot && r.CVR.length !== 1) errors.push(`CVR must have length 1 in a per-ballot file, got ${r.CVR.length}`);

  r.CVR.forEach((cvr, i) => {
    const at = `CVR[${i}]`;
    if (!isObj(cvr)) return void errors.push(`${at} must be an object`);
    expectType(errors, at, cvr, "CVR.CVR");
    for (const key of ["UniqueId", "CreatingDeviceId", "BallotStyleId", "BallotStyleUnitId", "CurrentSnapshotId", "ElectionId"]) {
      if (!isStr(cvr[key])) errors.push(`${at}.${key} must be a non-empty string`);
    }
    if (isStr(cvr.CreatingDeviceId) && !deviceIds.has(cvr.CreatingDeviceId)) {
      errors.push(`${at}.CreatingDeviceId ${cvr.CreatingDeviceId} is not a declared ReportingDevice`);
    }
    if (isStr(cvr.BallotStyleUnitId) && !gpUnitIds.has(cvr.BallotStyleUnitId)) {
      errors.push(`${at}.BallotStyleUnitId ${cvr.BallotStyleUnitId} is not a declared GpUnit`);
    }
    if (isStr(cvr.ElectionId) && electionIds.size > 0 && !electionIds.has(cvr.ElectionId)) {
      errors.push(`${at}.ElectionId does not match an Election`);
    }
    if (!isNonEmptyArray(cvr.CVRSnapshot)) return void errors.push(`${at}.CVRSnapshot must be a non-empty array`);
    cvr.CVRSnapshot.forEach((s, j) => {
      if (isObj(s)) expectType(errors, `${at}.CVRSnapshot[${j}]`, s, "CVR.CVRSnapshot");
    });
    const current = cvr.CVRSnapshot.find((s) => isObj(s) && s["@id"] === cvr.CurrentSnapshotId);
    if (!isObj(current)) return void errors.push(`${at}.CurrentSnapshotId does not name a CVRSnapshot`);
    if (!isNonEmptyArray(current.CVRContest)) return void errors.push(`${at} current snapshot has no CVRContest`);
    current.CVRContest.forEach((c, j) => {
      const ct = `${at}.CVRContest[${j}]`;
      if (!isObj(c) || !isStr(c.ContestId)) return void errors.push(`${ct}.ContestId must be a non-empty string`);
      expectType(errors, ct, c, "CVR.CVRContest");
      const known = declared.get(c.ContestId);
      if (!known) errors.push(`${ct}.ContestId ${c.ContestId} is not declared in Election.Contest`);
      if (!isNonEmptyArray(c.CVRContestSelection)) return void errors.push(`${ct} has no CVRContestSelection`);
      c.CVRContestSelection.forEach((s, k) => {
        const st = `${ct}.CVRContestSelection[${k}]`;
        if (!isObj(s) || !isStr(s.ContestSelectionId)) return void errors.push(`${st}.ContestSelectionId missing`);
        expectType(errors, st, s, "CVR.CVRContestSelection");
        if (known && !known.has(s.ContestSelectionId)) errors.push(`${st} selection ${s.ContestSelectionId} is not declared`);
        if (!isNonEmptyArray(s.SelectionPosition)) return void errors.push(`${st}.SelectionPosition must be non-empty`);
        for (const p of s.SelectionPosition) {
          if (!isObj(p) || !isStr(p.HasIndication) || !Number.isInteger(p.NumberVotes)) {
            errors.push(`${st}.SelectionPosition needs HasIndication and an integer NumberVotes`);
            continue;
          }
          expectType(errors, `${st}.SelectionPosition`, p, "CVR.SelectionPosition");
        }
      });
    });
  });
  return errors;
}
