// NIST SP 1500-103 cast vote record report, one ballot per file.

import {
  BALLOT_STYLE_ID,
  CONTESTS,
  COUNTY_ID,
  COUNTY_NAME,
  DEVICE_TYPE,
  DEVICE_VERSION,
  ELECTION_ID,
  ELECTION_NAME,
  precinctName,
} from "../fixture.ts";
import type { CvrCandidate, CvrContestDef, CvrFile, SimulatedBallot } from "../types.ts";

export function snapshotId(ballotId: string): string {
  return `${ballotId}-original`;
}

function contestDefs(): CvrContestDef[] {
  return CONTESTS.map((c): CvrContestDef =>
    c.kind === "candidate"
      ? {
          "@id": c.id,
          "@type": "CVR.CandidateContest",
          Name: c.name,
          VotesAllowed: c.votesAllowed,
          ContestSelection: c.selections.map((s) => ({
            "@id": s.id,
            "@type": "CVR.CandidateSelection",
            CandidateIds: [s.id],
          })),
        }
      : {
          "@id": c.id,
          "@type": "CVR.BallotMeasureContest",
          Name: c.name,
          ContestSelection: c.selections.map((s) => ({
            "@id": s.id,
            "@type": "CVR.BallotMeasureSelection",
            Selection: s.name,
          })),
        },
  );
}

function candidates(): CvrCandidate[] {
  return CONTESTS.filter((c) => c.kind === "candidate").flatMap((c) =>
    c.selections.map((s) => ({ "@id": s.id, "@type": "CVR.Candidate" as const, Name: s.name })),
  );
}

/** One NIST SP 1500-103 report holding one ballot; the file root is the report. */
export function buildCvrReport(ballot: SimulatedBallot, generatedDate: string): CvrFile {
  const sid = snapshotId(ballot.ballotId);
  return {
    "@type": "CVR.CastVoteRecordReport",
    Version: "1.0.0",
    GeneratedDate: generatedDate,
    ReportType: ["originating-device-export"],
    ReportGeneratingDeviceIds: [ballot.machineId],
    ReportingDevice: [
      {
        "@id": ballot.machineId,
        "@type": "CVR.ReportingDevice",
        Application: DEVICE_VERSION,
        Manufacturer: "VBT Simulator",
        Model: DEVICE_TYPE,
        SerialNumber: ballot.machineId,
      },
    ],
    GpUnit: [
      {
        "@id": ballot.precinctId,
        "@type": "CVR.GpUnit",
        Type: "precinct",
        Name: precinctName(ballot.precinctId),
        ReportingDeviceIds: [ballot.machineId],
      },
      { "@id": COUNTY_ID, "@type": "CVR.GpUnit", Type: "other", OtherType: "county", Name: COUNTY_NAME },
    ],
    Election: [
      {
        "@id": ELECTION_ID,
        "@type": "CVR.Election",
        Name: ELECTION_NAME,
        ElectionScopeId: COUNTY_ID,
        Candidate: candidates(),
        Contest: contestDefs(),
      },
    ],
    CVR: [
      {
        "@type": "CVR.CVR",
        UniqueId: ballot.ballotId,
        BallotStyleId: BALLOT_STYLE_ID,
        BallotStyleUnitId: ballot.precinctId,
        CreatingDeviceId: ballot.machineId,
        ElectionId: ELECTION_ID,
        CurrentSnapshotId: sid,
        CVRSnapshot: [
          {
            "@id": sid,
            "@type": "CVR.CVRSnapshot",
            Type: "original",
            CVRContest: CONTESTS.map((c) => ({
              "@type": "CVR.CVRContest" as const,
              ContestId: c.id,
              CVRContestSelection: [
                {
                  "@type": "CVR.CVRContestSelection" as const,
                  ContestSelectionId: ballot.selections[c.id] as string,
                  SelectionPosition: [
                    { "@type": "CVR.SelectionPosition" as const, HasIndication: "yes" as const, IsAllocable: "yes" as const, NumberVotes: 1 },
                  ],
                },
              ],
            })),
          },
        ],
      },
    ],
  };
}
