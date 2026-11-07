// The ports the demo script talks through. Every write is one of the locked endpoints (docs/locked-interfaces.md
// § API boundaries); there is deliberately no update or delete method anywhere, so the demo can't rewrite
// history (append-only, locked Principle 4).
//
// Until T-06 (tools/simulator, epic/4), T-07 (tools/receipts, epic/5), T-08 (the tracker) and T-09 (the
// official endpoints) reach main, tests use the in-memory stubs in stubs.ts and http-ports.ts targets the
// locked paths. See the README's stub table for what replaces each one.

import type { BallotStatus, BatchScope } from "@vbt/domain";

/** Monotonic milliseconds and an absolute sleep, so steps run at fixed offsets and delays never add up. */
export interface Clock {
  now(): number;
  /** Resolves once now() >= at; at once when `at` is already past. */
  sleepUntil(at: number): Promise<void>;
}

/** An exported file as an official uploads it (ingest is file-based, locked Event sources). */
export interface ExportFile {
  readonly name: string;
  readonly contentType: string;
  readonly body: string;
}

/** A row of the public view public.ballot_public (only the columns the demo reads). */
export interface SetBallot {
  readonly trackingCode: string;
  readonly status: BallotStatus;
  /** YYYY-MM-DD; the public record carries the date only. */
  readonly castDate: string;
}

/** What GET /api/track/{code} says about a ballot (the fields the demo checks). */
export interface TrackView {
  readonly status: BallotStatus;
  readonly reason: string | null;
}

export interface BatchRequest {
  readonly scope: BatchScope;
  readonly scopeId: string;
  readonly from: BallotStatus;
  readonly to: BallotStatus;
}

export interface BatchResult {
  readonly batchId: string;
  readonly count: number;
}

export interface Mismatch {
  readonly challengeId: string;
  readonly trackingCode: string;
}

export type Resolution = { readonly resolution: "accepted" } | { readonly resolution: "rejected"; readonly reason: string };

/** The locked endpoints, one method each. */
export interface ApiPort {
  /** POST /api/events: the official file upload. */
  uploadEventsFile(file: ExportFile): Promise<{ eventId: string }>;
  /** POST /api/batches. */
  createBatch(request: BatchRequest): Promise<BatchResult>;
  /** GET /api/reports/mismatches for one county. */
  listMismatches(countyId: string): Promise<Mismatch[]>;
  /** POST /api/challenges/{id}/resolve. */
  resolveChallenge(challengeId: string, resolution: Resolution): Promise<{ status: BallotStatus }>;
  /** GET /api/track/{code} (public). */
  readTrack(trackingCode: string): Promise<TrackView>;
  /** The public view public.ballot_public, filtered to one precinct. */
  readSet(precinctId: string): Promise<SetBallot[]>;
}

/** A non-2xx answer from an endpoint. The run stops on it; nothing is retried. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface SimulatedMachine {
  readonly vendor: string;
  readonly model: string;
  readonly publicKey: string;
}

/** One simulated ballot as the paper ballot record needs it. No tracking code: paper and receipt stay unlinked. */
export interface SimulatedBallot {
  readonly machineId: string;
  readonly ballotStyle: string;
  /** contest id -> selection ids. */
  readonly choices: Readonly<Record<string, readonly string[]>>;
}

/** The voting machine simulator (T-06): it only writes export files, never calls anything. */
export interface SimulatorPort {
  /** False until the real adapter is wired; callers refuse to start rather than fail part-way. */
  readonly available: boolean;
  machine(machineId: string): Promise<SimulatedMachine>;
  /** The machine's cast export for `count` ballots. */
  castExport(input: { setId: string; precinctId: string; countyId: string; machineId: string; count: number }): Promise<{
    file: ExportFile;
    ballots: SimulatedBallot[];
  }>;
  /** The machine log recording the voter spoiling this ballot. */
  spoilExport(input: { setId: string; trackingCode: string }): Promise<ExportFile>;
  /** A per-ballot paper/machine mismatch, so only this ballot is challenged. */
  mismatchExport(input: { setId: string; trackingCode: string }): Promise<ExportFile>;
  /** The precinct-close export; each code in `faults` gets a machine record that disagrees with its paper. */
  precinctCloseExport(input: { setId: string; faults: readonly string[] }): Promise<ExportFile>;
}

/** What a receipt shows (T-07 ReceiptInput, plus the URL its QR code opens). Never a label, time or choice. */
export interface ReceiptSpec {
  readonly trackingCode: string;
  /** `https://www.ballottrack.org/track/<code>`. */
  readonly url: string;
  readonly baseUrl: string;
  readonly precinctId: string;
  readonly precinctName: string;
  readonly countyName: string;
  readonly electionName: string;
  readonly electionDate: string;
  readonly castDate: string;
}

/** What a paper ballot record shows (T-07 PaperBallotInput, less the manifest the adapter supplies). */
export interface PaperBallotSpec {
  readonly machineId: string;
  readonly precinctId: string;
  readonly precinctName: string;
  readonly ballotStyle: string;
  readonly castDate: string;
  readonly countyName: string;
  readonly electionName: string;
  readonly choices: Readonly<Record<string, readonly string[]>>;
}

/** The receipt and paper ballot generator (T-07). Returns PDF bytes. */
export interface ReceiptsPort {
  readonly available: boolean;
  receipt(spec: ReceiptSpec): Promise<Uint8Array>;
  paperBallot(spec: PaperBallotSpec): Promise<Uint8Array>;
}

/** The two reference rows a set needs, inserted with service_role. Insert only. */
export interface RegistryWriter {
  insertPrecinct(row: { id: string; county_id: string; name: string }): Promise<void>;
  insertMachine(row: { id: string; precinct_id: string; vendor: string; model: string; public_key: string }): Promise<void>;
}

/** Where the seed writes printable files (relative paths). */
export interface FileSink {
  write(path: string, contents: string | Uint8Array): Promise<void>;
}
