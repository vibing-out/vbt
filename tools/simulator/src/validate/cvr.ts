// Structural validator for the minimal NIST SP 1500-103 report shape this tool
// emits (one CVR per file). Returns a list of problems; empty means valid.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v !== "";
const isNonEmptyArray = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0;

export function validateCvrReport(file: unknown, opts: { perBallot?: boolean } = { perBallot: true }): string[] {
  const errors: string[] = [];
  if (!isObj(file) || !isObj(file.CastVoteRecordReport)) return ["root must be { CastVoteRecordReport: {...} }"];
  const r = file.CastVoteRecordReport;

  if (r.Version !== "1.0.0") errors.push('Version must be "1.0.0"');
  if (!isNonEmptyArray(r.ReportGeneratingDeviceIds) || !r.ReportGeneratingDeviceIds.every(isStr)) {
    errors.push("ReportGeneratingDeviceIds must be a non-empty string array");
  }
  if (!isNonEmptyArray(r.GPUnit) || !r.GPUnit.every((g) => isObj(g) && isStr(g["@id"]) && isStr(g.Type))) {
    errors.push("GPUnit must be a non-empty array of { @id, Type }");
  }

  // Contest and selection ids declared by the Election, for cross-reference.
  const declared = new Map<string, Set<string>>();
  const electionIds = new Set<string>();
  if (!isNonEmptyArray(r.Election)) {
    errors.push("Election must be a non-empty array");
  } else {
    r.Election.forEach((el, i) => {
      if (!isObj(el) || !isStr(el["@id"]) || !isNonEmptyArray(el.Contest)) {
        return void errors.push(`Election[${i}] needs @id and a non-empty Contest array`);
      }
      electionIds.add(el["@id"]);
      for (const c of el.Contest) {
        if (!isObj(c) || !isStr(c["@id"]) || !Array.isArray(c.ContestSelection)) continue;
        declared.set(
          c["@id"],
          new Set(c.ContestSelection.filter(isObj).map((s) => s["@id"]).filter(isStr)),
        );
      }
    });
  }

  if (!Array.isArray(r.CVR)) return [...errors, "CVR must be an array"];
  if (opts.perBallot && r.CVR.length !== 1) errors.push(`CVR must have length 1 in a per-ballot file, got ${r.CVR.length}`);

  r.CVR.forEach((cvr, i) => {
    const at = `CVR[${i}]`;
    if (!isObj(cvr)) return void errors.push(`${at} must be an object`);
    for (const key of ["UniqueId", "CreatingDeviceId", "BallotStyleId", "BallotStyleUnitId", "CurrentSnapshotId"]) {
      if (!isStr(cvr[key])) errors.push(`${at}.${key} must be a non-empty string`);
    }
    if (isStr(cvr.ElectionId) && electionIds.size > 0 && !electionIds.has(cvr.ElectionId)) {
      errors.push(`${at}.ElectionId does not match an Election`);
    }
    if (!isNonEmptyArray(cvr.CVRSnapshot)) return void errors.push(`${at}.CVRSnapshot must be a non-empty array`);
    const current = cvr.CVRSnapshot.find((s) => isObj(s) && s["@id"] === cvr.CurrentSnapshotId);
    if (!isObj(current)) return void errors.push(`${at}.CurrentSnapshotId does not name a CVRSnapshot`);
    if (!isNonEmptyArray(current.CVRContest)) return void errors.push(`${at} current snapshot has no CVRContest`);
    current.CVRContest.forEach((c, j) => {
      const ct = `${at}.CVRContest[${j}]`;
      if (!isObj(c) || !isStr(c.ContestId)) return void errors.push(`${ct}.ContestId must be a non-empty string`);
      const known = declared.get(c.ContestId);
      if (!known) errors.push(`${ct}.ContestId ${c.ContestId} is not declared in Election.Contest`);
      if (!isNonEmptyArray(c.CVRContestSelection)) return void errors.push(`${ct} has no CVRContestSelection`);
      c.CVRContestSelection.forEach((s, k) => {
        const st = `${ct}.CVRContestSelection[${k}]`;
        if (!isObj(s) || !isStr(s.ContestSelectionId)) return void errors.push(`${st}.ContestSelectionId missing`);
        if (known && !known.has(s.ContestSelectionId)) errors.push(`${st} selection ${s.ContestSelectionId} is not declared`);
        if (!isNonEmptyArray(s.SelectionPosition)) return void errors.push(`${st}.SelectionPosition must be non-empty`);
        for (const p of s.SelectionPosition) {
          if (!isObj(p) || !isStr(p.HasIndication) || typeof p.NumberVotes !== "number") {
            errors.push(`${st}.SelectionPosition needs HasIndication and NumberVotes`);
          }
        }
      });
    });
  });
  return errors;
}
