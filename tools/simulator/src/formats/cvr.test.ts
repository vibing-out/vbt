import { describe, expect, it } from "vitest";
import { CONTESTS, COUNTY_ID } from "../fixture.ts";
import { allocateBallots } from "../generate.ts";
import { nistSchemaErrors, readSample } from "../test/nist-schema.ts";
import { validateCvrReport } from "../validate/cvr.ts";
import { buildCvrReport } from "./cvr.ts";

const [ballot] = allocateBallots(
  { ballots: 1, mismatchRate: 0, seed: "cvr", machines: 1, precincts: 1 },
  [{ id: "mach-01", precinctId: "pct-01", type: "scan-single" }],
);

function build() {
  if (!ballot) throw new Error("no ballot");
  return buildCvrReport(ballot, "2026-11-03T07:00:00.000Z");
}

type Loose = Record<string, unknown>;

describe("vendored NIST SP 1500-103 schema", () => {
  it("accepts the hand-written sample report", () => {
    expect(nistSchemaErrors(readSample())).toEqual([]);
  });

  it("the semantic validator accepts the sample too", () => {
    expect(validateCvrReport(readSample())).toEqual([]);
  });

  it.each([
    ["a wrapped root", (r: Loose) => ({ CastVoteRecordReport: r })],
    ["a bare @type", (r: Loose) => ({ ...r, "@type": "CastVoteRecordReport" })],
    ["GPUnit instead of GpUnit", ({ GpUnit, ...r }: Loose) => ({ ...r, GPUnit: GpUnit })],
    ["no ReportingDevice", ({ ReportingDevice: _, ...r }: Loose) => r],
    ["a county GpUnit typed county", (r: Loose) => ({ ...r, GpUnit: [{ "@id": "x", "@type": "CVR.GpUnit", Type: "county" }] })],
    ["VotesAllowed on a ballot measure", (r: Loose) => {
      const c = structuredClone(r) as { Election: Array<{ Contest: Loose[] }> };
      const measure = c.Election[0]!.Contest.find((x) => x["@type"] === "CVR.BallotMeasureContest")!;
      measure.VotesAllowed = 1;
      return c;
    }],
  ])("rejects %s", (_name, mutate) => {
    expect(nistSchemaErrors(mutate(readSample() as Loose))).not.toEqual([]);
  });
});

describe("CVR builder", () => {
  it("is valid against the vendored NIST schema", () => {
    expect(nistSchemaErrors(JSON.parse(JSON.stringify(build())))).toEqual([]);
  });

  it("passes the semantic validator and uses NIST names", () => {
    const r = build();
    expect(validateCvrReport(r)).toEqual([]);
    expect(r["@type"]).toBe("CVR.CastVoteRecordReport");
    expect(r.Version).toBe("1.0.0");
    expect(r.CVR).toHaveLength(1);
    expect(r.ReportGeneratingDeviceIds).toEqual(["mach-01"]);
    expect(r.ReportingDevice.map((d) => [d["@id"], d["@type"]])).toEqual([["mach-01", "CVR.ReportingDevice"]]);
    expect(r.GpUnit.find((g) => g["@id"] === COUNTY_ID)).toMatchObject({ "@type": "CVR.GpUnit", Type: "other", OtherType: "county" });
    expect(r.GpUnit.find((g) => g["@id"] === "pct-01")).toMatchObject({ "@type": "CVR.GpUnit", Type: "precinct" });
    expect(r.Election[0]?.["@type"]).toBe("CVR.Election");
    const cvr = r.CVR[0];
    expect(cvr?.["@type"]).toBe("CVR.CVR");
    expect(cvr?.UniqueId).toBe(ballot?.ballotId);
    expect(cvr?.CreatingDeviceId).toBe("mach-01");
    expect(cvr?.BallotStyleUnitId).toBe("pct-01");
    const snap = cvr?.CVRSnapshot.find((s) => s["@id"] === cvr.CurrentSnapshotId);
    expect(snap?.["@type"]).toBe("CVR.CVRSnapshot");
    expect(snap?.Type).toBe("original");
    expect(snap?.CVRContest.map((c) => c.ContestId)).toEqual(CONTESTS.map((c) => c.id));
    for (const c of snap?.CVRContest ?? []) {
      expect(c["@type"]).toBe("CVR.CVRContest");
      expect(c.CVRContestSelection).toHaveLength(1);
      expect(c.CVRContestSelection[0]?.["@type"]).toBe("CVR.CVRContestSelection");
      expect(c.CVRContestSelection[0]?.ContestSelectionId).toBe(ballot?.selections[c.ContestId]);
      expect(c.CVRContestSelection[0]?.SelectionPosition).toEqual([
        { "@type": "CVR.SelectionPosition", HasIndication: "yes", IsAllocable: "yes", NumberVotes: 1 },
      ]);
    }
  });

  it("validator rejects a wrong version, two CVRs or an undeclared selection", () => {
    const bad = build();
    (bad as { Version: string }).Version = "2.0.0";
    bad.CVR.push(structuredClone(bad.CVR[0]!));
    bad.CVR[0]!.CVRSnapshot[0]!.CVRContest[0]!.CVRContestSelection[0]!.ContestSelectionId = "cand-z";
    const errors = validateCvrReport(bad).join("\n");
    expect(errors).toMatch(/Version/);
    expect(errors).toMatch(/length 1/);
    expect(errors).toMatch(/cand-z/);
  });

  it("validator rejects a wrapped root", () => {
    expect(validateCvrReport({ CastVoteRecordReport: build() }).join("\n")).toMatch(/not wrapped/);
  });

  it("validator rejects GPUnit, bare @types and a county without OtherType", () => {
    const { GpUnit, ...rest } = build();
    const county = GpUnit.find((g) => g["@id"] === COUNTY_ID)!;
    delete county.OtherType;
    const bad = { ...rest, "@type": "CastVoteRecordReport", GPUnit: GpUnit } as Loose;
    (bad.CVR as Loose[])[0]!["@type"] = "CVR";
    const errors = validateCvrReport(bad).join("\n");
    expect(errors).toMatch(/report\.@type must be "CVR\.CastVoteRecordReport"/);
    expect(errors).toMatch(/use GpUnit/);
    expect(errors).toMatch(/GpUnit must be a non-empty array/);
    expect(errors).toMatch(/CVR\[0\]\.@type must be "CVR\.CVR"/);

    const r2 = build();
    delete r2.GpUnit.find((g) => g["@id"] === COUNTY_ID)!.OtherType;
    expect(validateCvrReport(r2).join("\n")).toMatch(/Type "other" without OtherType/);
  });

  it("validator rejects device ids that don't resolve to a ReportingDevice", () => {
    const r = build();
    r.ReportGeneratingDeviceIds = ["mach-99"];
    r.CVR[0]!.CreatingDeviceId = "mach-98";
    const errors = validateCvrReport(r).join("\n");
    expect(errors).toMatch(/ReportGeneratingDeviceIds mach-99 is not a declared ReportingDevice/);
    expect(errors).toMatch(/CreatingDeviceId mach-98 is not a declared ReportingDevice/);

    const noDevices = { ...build(), ReportingDevice: [] };
    expect(validateCvrReport(noDevices).join("\n")).toMatch(/ReportingDevice must be a non-empty array/);
  });
});
