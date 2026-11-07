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
// Names and `@type` values follow the official JSON schema
// (vendor/nist-sp-1500-103/cvr-minimal.schema.json).

export interface CvrCandidateSelectionDef {
  "@id": string;
  "@type": "CVR.CandidateSelection";
  CandidateIds: string[];
}

export interface CvrBallotMeasureSelectionDef {
  "@id": string;
  "@type": "CVR.BallotMeasureSelection";
  Selection: string;
}

export type CvrContestSelectionDef = CvrCandidateSelectionDef | CvrBallotMeasureSelectionDef;

export interface CvrCandidateContestDef {
  "@id": string;
  "@type": "CVR.CandidateContest";
  Name: string;
  VotesAllowed: number;
  ContestSelection: CvrCandidateSelectionDef[];
}

/** The schema has no VotesAllowed on BallotMeasureContest. */
export interface CvrBallotMeasureContestDef {
  "@id": string;
  "@type": "CVR.BallotMeasureContest";
  Name: string;
  ContestSelection: CvrBallotMeasureSelectionDef[];
}

export type CvrContestDef = CvrCandidateContestDef | CvrBallotMeasureContestDef;

export interface CvrCandidate {
  "@id": string;
  "@type": "CVR.Candidate";
  Name: string;
}

export interface CvrSelectionPosition {
  "@type": "CVR.SelectionPosition";
  HasIndication: "yes" | "no" | "unknown";
  IsAllocable: "yes" | "no" | "unknown";
  NumberVotes: number;
}

export interface CvrContestSelection {
  "@type": "CVR.CVRContestSelection";
  ContestSelectionId: string;
  SelectionPosition: CvrSelectionPosition[];
}

export interface CvrContest {
  "@type": "CVR.CVRContest";
  ContestId: string;
  CVRContestSelection: CvrContestSelection[];
}

export interface CvrSnapshot {
  "@id": string;
  "@type": "CVR.CVRSnapshot";
  Type: "original" | "interpreted" | "modified";
  CVRContest: CvrContest[];
}

export interface CvrBallot {
  "@type": "CVR.CVR";
  UniqueId: string;
  BallotStyleId: string;
  BallotStyleUnitId: string;
  CreatingDeviceId: string;
  ElectionId: string;
  BatchId?: string;
  CurrentSnapshotId: string;
  CVRSnapshot: CvrSnapshot[];
}

export type CvrReportingUnitType =
  | "combined-precinct"
  | "other"
  | "polling-place"
  | "precinct"
  | "split-precinct"
  | "vote-center";

/** ReportingUnitType has no "county"; a county is Type "other" with OtherType "county". */
export interface CvrGpUnit {
  "@id": string;
  "@type": "CVR.GpUnit";
  Type: CvrReportingUnitType;
  OtherType?: string;
  Name: string;
  ReportingDeviceIds?: string[];
}

export interface CvrReportingDevice {
  "@id": string;
  "@type": "CVR.ReportingDevice";
  Application?: string;
  Manufacturer?: string;
  Model?: string;
  SerialNumber?: string;
}

export interface CvrElection {
  "@id": string;
  "@type": "CVR.Election";
  Name: string;
  ElectionScopeId: string;
  Candidate?: CvrCandidate[];
  Contest: CvrContestDef[];
}

export interface CastVoteRecordReport {
  "@type": "CVR.CastVoteRecordReport";
  Version: "1.0.0";
  GeneratedDate: string;
  ReportType: Array<"originating-device-export">;
  ReportGeneratingDeviceIds: string[];
  ReportingDevice: CvrReportingDevice[];
  GpUnit: CvrGpUnit[];
  Election: CvrElection[];
  CVR: CvrBallot[];
}

/**
 * Root object of a `<ballotId>.cvr.json` file. Per the NIST schema
 * (`$ref: CVR.CastVoteRecordReport`) the root is the report itself, unwrapped.
 */
export type CvrFile = CastVoteRecordReport;

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
