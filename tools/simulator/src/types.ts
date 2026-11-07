// Types local to the simulator. They describe file exports only and are not
// the domain model (that lives in packages/domain).

// ---------- VotingWorks CDF election event log (JSON mapping) ----------

export type DeviceType = "scan-single" | "bmd" | "ems" | "scan-batch";
export type Disposition = "success" | "failure" | "na" | "other";

export interface CdfEvent {
  Id: string;
  Type?: string;
  Disposition: Disposition;
  Sequence: number;
  TimeStamp: string;
  UserId?: string;
  Description?: string;
  Details?: string;
}

export interface CdfDevice {
  Type: DeviceType;
  Id: string;
  Version: string;
  Event: CdfEvent[];
}

export interface ElectionEventLog {
  GeneratedTime: string;
  Device: CdfDevice[];
}

/** Root object of a `vx-logs.cdf.json` file. */
export interface CdfLogFile {
  ElectionEventLog: ElectionEventLog;
}

// ---------- NIST SP 1500-103 cast vote record report (subset) ----------

export interface CvrContestSelectionDef {
  "@id": string;
  "@type": "CandidateSelection" | "BallotMeasureSelection";
  CandidateIds?: string[];
  Selection?: string;
}

export interface CvrContestDef {
  "@id": string;
  "@type": "CandidateContest" | "BallotMeasureContest";
  Name: string;
  VotesAllowed: number;
  ContestSelection: CvrContestSelectionDef[];
}

export interface CvrSelectionPosition {
  HasIndication: "yes" | "no" | "unknown";
  IsAllocable: "yes" | "no" | "unknown";
  NumberVotes: number;
}

export interface CvrContestSelection {
  ContestSelectionId: string;
  SelectionPosition: CvrSelectionPosition[];
}

export interface CvrContest {
  ContestId: string;
  CVRContestSelection: CvrContestSelection[];
}

export interface CvrSnapshot {
  "@id": string;
  Type: "original" | "interpreted" | "modified";
  CVRContest: CvrContest[];
}

export interface CvrBallot {
  UniqueId: string;
  BallotStyleId: string;
  BallotStyleUnitId: string;
  CreatingDeviceId: string;
  ElectionId: string;
  BatchId?: string;
  CurrentSnapshotId: string;
  CVRSnapshot: CvrSnapshot[];
}

export interface CastVoteRecordReport {
  "@type"?: "CastVoteRecordReport";
  Version: "1.0.0";
  GeneratedDate: string;
  ReportType: Array<"originating-device-export">;
  ReportGeneratingDeviceIds: string[];
  GPUnit: Array<{ "@id": string; Type: "precinct" | "other"; Name: string }>;
  Party?: Array<{ "@id": string; Name: string; Abbreviation?: string }>;
  Election: Array<{
    "@id": string;
    Name: string;
    ElectionScopeId: string;
    Candidate?: Array<{ "@id": string; Name: string }>;
    Contest: CvrContestDef[];
  }>;
  CVR: CvrBallot[];
}

/** Root object of a `<ballotId>.cvr.json` file. */
export interface CvrFile {
  CastVoteRecordReport: CastVoteRecordReport;
}

// ---------- Manifest and faults ----------

export type FaultType =
  | "missing_log_entry"
  | "alter_precinct_totals"
  | "alter_county_enr_totals"
  | "alter_certified_totals";

export type CheckId = "C1" | "C2" | "C3" | "C4";

export interface ManifestFault {
  ballotId: string;
  machineId: string;
  precinctId: string;
  type: FaultType;
  failsCheck: CheckId;
  detail: string;
}

export interface ManifestMachine {
  id: string;
  precinctId: string;
  type: DeviceType;
}

export interface Manifest {
  version: 1;
  seed: string;
  ballots: number;
  mismatchRate: number;
  faultCount: number;
  electionId: string;
  countyId: string;
  precincts: string[];
  machines: ManifestMachine[];
  ballotIds: string[];
  faults: ManifestFault[];
  files: string[];
}

// ---------- Totals (simulator-private) ----------

export interface TotalsFile {
  scope: "precinct" | "county-unofficial" | "county-certified";
  scopeId: string;
  electionId: string;
  ballotCount: number;
  contests: Array<{
    contestId: string;
    selections: Array<{ selectionId: string; votes: number }>;
  }>;
}

// ---------- Internal generation model ----------

export interface SimulatedBallot {
  index: number;
  ballotId: string;
  machineId: string;
  precinctId: string;
  sequenceOnMachine: number;
  /** contestId → selectionId, in fixture contest order. */
  selections: Record<string, string>;
}

export interface SimulateOptions {
  ballots: number;
  mismatchRate: number;
  seed: string;
  machines: number;
  precincts: number;
}

export interface SimulationOutput {
  manifest: Manifest;
  /** Relative path → JSON value. Includes manifest.json. */
  files: Map<string, unknown>;
}
