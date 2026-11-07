import { describe, expect, it } from "vitest";
import { CONTESTS } from "../fixture.ts";
import { allocateBallots } from "../generate.ts";
import { validateCvrReport } from "../validate/cvr.ts";
import { buildCvrReport } from "./cvr.ts";

const [ballot] = allocateBallots(
  { ballots: 1, mismatchRate: 0, seed: "cvr", machines: 1, precincts: 1 },
  [{ id: "mach-01", precinctId: "pct-01", type: "scan-single" }],
);

describe("CVR builder", () => {
  it("passes the 1500-103 minimal-shape validator", () => {
    if (!ballot) throw new Error("no ballot");
    const file = buildCvrReport(ballot, "2026-11-03T07:00:00.000Z");
    expect(validateCvrReport(file)).toEqual([]);
    const r = file.CastVoteRecordReport;
    expect(r.Version).toBe("1.0.0");
    expect(r.CVR).toHaveLength(1);
    expect(r.ReportGeneratingDeviceIds).toEqual(["mach-01"]);
    const cvr = r.CVR[0];
    expect(cvr?.UniqueId).toBe(ballot.ballotId);
    expect(cvr?.CreatingDeviceId).toBe("mach-01");
    expect(cvr?.BallotStyleUnitId).toBe("pct-01");
    const snap = cvr?.CVRSnapshot.find((s) => s["@id"] === cvr.CurrentSnapshotId);
    expect(snap?.Type).toBe("original");
    expect(snap?.CVRContest.map((c) => c.ContestId)).toEqual(CONTESTS.map((c) => c.id));
    for (const c of snap?.CVRContest ?? []) {
      expect(c.CVRContestSelection).toHaveLength(1);
      expect(c.CVRContestSelection[0]?.ContestSelectionId).toBe(ballot.selections[c.ContestId]);
      expect(c.CVRContestSelection[0]?.SelectionPosition).toEqual([{ HasIndication: "yes", IsAllocable: "yes", NumberVotes: 1 }]);
    }
  });

  it("validator rejects a wrong version, two CVRs or an undeclared selection", () => {
    if (!ballot) throw new Error("no ballot");
    const bad = buildCvrReport(ballot, "2026-11-03T07:00:00.000Z");
    (bad.CastVoteRecordReport as { Version: string }).Version = "2.0.0";
    bad.CastVoteRecordReport.CVR.push(structuredClone(bad.CastVoteRecordReport.CVR[0]!));
    const sel = bad.CastVoteRecordReport.CVR[0]!.CVRSnapshot[0]!.CVRContest[0]!.CVRContestSelection[0]!;
    sel.ContestSelectionId = "cand-z";
    const errors = validateCvrReport(bad).join("\n");
    expect(errors).toMatch(/Version/);
    expect(errors).toMatch(/length 1/);
    expect(errors).toMatch(/cand-z/);
  });
});
