// NIST SP 1500-103 cast vote record report, one ballot per file.

import {
  BALLOT_STYLE_ID,
  CONTESTS,
  COUNTY_ID,
  COUNTY_NAME,
  ELECTION_ID,
  ELECTION_NAME,
  precinctName,
} from "../fixture.ts";
import type { CvrContestDef, CvrFile, SimulatedBallot } from "../types.ts";

export function snapshotId(ballotId: string): string {
  return `${ballotId}-original`;
}

function contestDefs(): CvrContestDef[] {
  return CONTESTS.map((c) =>
    c.kind === "candidate"
      ? {
          "@id": c.id,
          "@type": "CandidateContest",
          Name: c.name,
          VotesAllowed: c.votesAllowed,
          ContestSelection: c.selections.map((s) => ({
            "@id": s.id,
            "@type": "CandidateSelection",
            CandidateIds: [s.id],
          })),
        }
      : {
          "@id": c.id,
          "@type": "BallotMeasureContest",
          Name: c.name,
          VotesAllowed: c.votesAllowed,
          ContestSelection: c.selections.map((s) => ({
            "@id": s.id,
            "@type": "BallotMeasureSelection",
            Selection: s.name,
          })),
        },
  );
}

function candidates(): Array<{ "@id": string; Name: string }> {
  return CONTESTS.filter((c) => c.kind === "candidate").flatMap((c) =>
    c.selections.map((s) => ({ "@id": s.id, Name: s.name })),
  );
}

export function buildCvrReport(ballot: SimulatedBallot, generatedDate: string): CvrFile {
  const sid = snapshotId(ballot.ballotId);
  return {
    CastVoteRecordReport: {
      "@type": "CastVoteRecordReport",
      Version: "1.0.0",
      GeneratedDate: generatedDate,
      ReportType: ["originating-device-export"],
      ReportGeneratingDeviceIds: [ballot.machineId],
      GPUnit: [
        { "@id": ballot.precinctId, Type: "precinct", Name: precinctName(ballot.precinctId) },
        { "@id": COUNTY_ID, Type: "other", Name: COUNTY_NAME },
      ],
      Election: [
        {
          "@id": ELECTION_ID,
          Name: ELECTION_NAME,
          ElectionScopeId: COUNTY_ID,
          Candidate: candidates(),
          Contest: contestDefs(),
        },
      ],
      CVR: [
        {
          UniqueId: ballot.ballotId,
          BallotStyleId: BALLOT_STYLE_ID,
          BallotStyleUnitId: ballot.precinctId,
          CreatingDeviceId: ballot.machineId,
          ElectionId: ELECTION_ID,
          CurrentSnapshotId: sid,
          CVRSnapshot: [
            {
              "@id": sid,
              Type: "original",
              CVRContest: CONTESTS.map((c) => ({
                ContestId: c.id,
                CVRContestSelection: [
                  {
                    ContestSelectionId: ballot.selections[c.id] as string,
                    SelectionPosition: [{ HasIndication: "yes", IsAllocable: "yes", NumberVotes: 1 }],
                  },
                ],
              })),
            },
          ],
        },
      ],
    },
  };
}
