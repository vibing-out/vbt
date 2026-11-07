// In-memory stand-ins for the endpoints, simulator and receipt generator that aren't on main yet. Status
// changes go through @vbt/domain transition() and validateBatchTransition(), so a stub refuses exactly what
// the domain refuses. Used by tests and by the CLI's --stub dry run; never by the route in production.
//
// Stub                          Replaced by
// api.uploadEventsFile          POST /api/events, the official file upload (T-09)
// api.createBatch               POST /api/batches (T-09)
// api.listMismatches            GET /api/reports/mismatches (T-09)
// api.resolveChallenge          POST /api/challenges/{id}/resolve (T-09)
// api.readTrack                 GET /api/track/{code} (T-08)
// api.readSet                   public.ballot_public (exists; http-ports.ts reads it)
// simulator                     tools/simulator (T-06, origin/epic/4)
// receipts                      tools/receipts (T-07, epic/5)

import { type BallotStatus, transition, validateBatchTransition } from "@vbt/domain";
import {
  ApiError,
  type ApiPort,
  type Clock,
  type ExportFile,
  type FileSink,
  type Mismatch,
  type ReceiptsPort,
  type RegistryWriter,
  type SetBallot,
  type SimulatorPort,
} from "./ports.ts";

export type ApiMethod = keyof ApiPort;
export const WRITE_METHODS: readonly ApiMethod[] = ["uploadEventsFile", "createBatch", "resolveChallenge"];

export interface StubCall {
  readonly method: ApiMethod;
  /** Clock time when the call was made. */
  readonly at: number;
  readonly args: readonly unknown[];
}

export interface StubEvent {
  readonly eventType: "CAST" | "STATUS_CHANGE" | "MISMATCH_DETECTED" | "CHALLENGE_RESOLVED" | "SPOILED";
  readonly trackingCode: string;
  readonly from: BallotStatus | null;
  readonly to: BallotStatus;
  readonly reason: string | null;
  readonly batchId: string | null;
}

export interface StubOptions {
  /** The upload refuses spoil events as an unsupported event type (ticket AC 8). */
  spoilUnsupported?: boolean;
  /** GET /api/track shows a change only this long after it happened. */
  trackLagMs?: number;
  /** Each call to this method takes this long on the clock before it acts. */
  delayMs?: Partial<Record<ApiMethod, number>>;
  /** The nth (1-based, default 1) call to `method` answers `status`. */
  failOn?: { method: ApiMethod; status: number; message?: string; nth?: number };
  /** Cast date the stub records (date only). */
  castDate?: string;
}

interface StubBallot {
  code: string;
  precinctId: string;
  countyId: string;
  status: BallotStatus;
  reason: string | null;
  castDate: string;
  history: Array<{ status: BallotStatus; reason: string | null; at: number }>;
}

interface StubChallenge {
  id: string;
  code: string;
  held: BallotStatus;
  open: boolean;
}

/** FNV-1a, for stable stub tracking codes whose sorted order isn't their cast order. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // murmur3 finalizer: neighbouring inputs land far apart, like real hash-based codes.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

const json = (kind: string, body: Record<string, unknown>): ExportFile => ({
  name: `${kind}.json`,
  contentType: "application/json",
  body: JSON.stringify({ kind, ...body }),
});

/** A whole stub world: endpoints, simulator, receipts, the service_role writer and a file sink. */
export function stubWorld(clock: Clock, options: StubOptions = {}) {
  const precincts = new Map<string, { county_id: string; name: string }>();
  const machines = new Map<string, { precinct_id: string }>();
  const ballots = new Map<string, StubBallot>();
  const challenges: StubChallenge[] = [];
  const events: StubEvent[] = [];
  const calls: StubCall[] = [];
  const files = new Map<string, string | Uint8Array>();
  let ids = 0;
  const nextId = (prefix: string) => `${prefix}-${String(++ids).padStart(4, "0")}`;

  const castDate = options.castDate ?? "2026-11-03";
  const lag = options.trackLagMs ?? 0;

  const ballot = (code: string) => {
    const found = ballots.get(code);
    if (!found) throw new ApiError(404, `unknown tracking code ${code}`);
    return found;
  };

  const record = (b: StubBallot, to: BallotStatus, eventType: StubEvent["eventType"], extra: { reason?: string; batchId?: string } = {}) => {
    events.push({ eventType, trackingCode: b.code, from: b.status, to, reason: extra.reason ?? null, batchId: extra.batchId ?? null });
    b.status = to;
    if (extra.reason !== undefined) b.reason = extra.reason;
    b.history.push({ status: to, reason: b.reason, at: clock.now() });
  };

  const move = (b: StubBallot, to: BallotStatus, eventType: StubEvent["eventType"], extra: { reason?: string; heldStatus?: BallotStatus; batchId?: string } = {}) => {
    const result = transition({ from: b.status, to, ...extra });
    if (!result.ok) throw new ApiError(409, `${result.code}: ${result.message}`);
    record(b, to, eventType, extra);
  };

  const challenge = (b: StubBallot) => {
    const held = b.status;
    move(b, "CHALLENGED", "MISMATCH_DETECTED");
    challenges.push({ id: nextId("challenge"), code: b.code, held, open: true });
  };

  const counts = new Map<ApiMethod, number>();
  /** Logs the call, applies the configured delay and failure, then acts. */
  const call = async <T>(method: ApiMethod, args: unknown[], act: () => T | Promise<T>): Promise<T> => {
    calls.push({ method, at: clock.now(), args });
    const n = (counts.get(method) ?? 0) + 1;
    counts.set(method, n);
    const delay = options.delayMs?.[method];
    if (delay) await clock.sleepUntil(clock.now() + delay);
    const fail = options.failOn;
    if (fail && fail.method === method && (fail.nth ?? 1) === n) throw new ApiError(fail.status, fail.message ?? "stub failure");
    return act();
  };

  const ingest = (file: ExportFile) => {
    const doc = JSON.parse(file.body) as Record<string, unknown>;
    switch (doc.kind) {
      case "cast": {
        const precinctId = String(doc.precinctId);
        const precinct = precincts.get(precinctId);
        if (!precinct || !machines.has(String(doc.machineId))) throw new ApiError(422, "unknown precinct or machine");
        for (let i = 0; i < Number(doc.count); i++) {
          const raw = fnv(`${String(doc.setId)}:${i}`);
          const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
          const b: StubBallot = { code, precinctId, countyId: precinct.county_id, status: "CAST", reason: null, castDate, history: [] };
          ballots.set(code, b);
          events.push({ eventType: "CAST", trackingCode: code, from: null, to: "CAST", reason: null, batchId: null });
          b.history.push({ status: "CAST", reason: null, at: clock.now() });
        }
        return;
      }
      case "spoil": {
        if (options.spoilUnsupported) throw new ApiError(422, "unsupported event type SPOILED");
        move(ballot(String(doc.trackingCode)), "SPOILED", "SPOILED");
        return;
      }
      case "mismatch":
        challenge(ballot(String(doc.trackingCode)));
        return;
      case "precinct-close":
        for (const code of doc.faults as string[]) challenge(ballot(code));
        return;
      default:
        throw new ApiError(400, "unrecognized export file");
    }
  };

  const api: ApiPort = {
    uploadEventsFile: (file) =>
      call("uploadEventsFile", [file], () => {
        ingest(file);
        return { eventId: nextId("event") };
      }),
    createBatch: (request) =>
      call("createBatch", [request], () => {
        const check = validateBatchTransition({ from: request.from, to: request.to, scope: request.scope });
        if (!check.ok) throw new ApiError(422, `${check.code}: ${check.message}`);
        const batchId = nextId("batch");
        const members = [...ballots.values()].filter(
          (b) => (request.scope === "precinct" ? b.precinctId : b.countyId) === request.scopeId && b.status === request.from,
        );
        for (const b of members) move(b, request.to, "STATUS_CHANGE", { batchId });
        return { batchId, count: members.length };
      }),
    listMismatches: (countyId) =>
      call("listMismatches", [countyId], (): Mismatch[] =>
        challenges.filter((c) => c.open && ballot(c.code).countyId === countyId).map((c) => ({ challengeId: c.id, trackingCode: c.code })),
      ),
    resolveChallenge: (challengeId, resolution) =>
      call("resolveChallenge", [challengeId, resolution], () => {
        const c = challenges.find((x) => x.id === challengeId && x.open);
        if (!c) throw new ApiError(404, "no open challenge");
        const b = ballot(c.code);
        if (resolution.resolution === "accepted") move(b, c.held, "CHALLENGE_RESOLVED", { heldStatus: c.held });
        else move(b, "DISCARDED", "CHALLENGE_RESOLVED", { reason: resolution.reason });
        c.open = false;
        return { status: b.status };
      }),
    readTrack: (code) =>
      call("readTrack", [code], () => {
        const b = ballot(code);
        const visible = b.history.filter((h) => h.at <= clock.now() - lag);
        const shown = visible[visible.length - 1] ?? b.history[0]!;
        return { status: shown.status, reason: shown.reason };
      }),
    readSet: (precinctId) =>
      call("readSet", [precinctId], (): SetBallot[] =>
        [...ballots.values()]
          .filter((b) => b.precinctId === precinctId)
          .map((b) => ({ trackingCode: b.code, status: b.status, castDate: b.castDate }))
          .sort((x, y) => (x.trackingCode < y.trackingCode ? -1 : 1)),
      ),
  };

  const simulator: SimulatorPort = {
    available: true,
    machine: async () => ({ vendor: "VBT simulator", model: "stub", publicKey: "stub-public-key" }),
    castExport: async ({ setId, precinctId, countyId, machineId, count }) => ({
      file: json("cast", { setId, precinctId, countyId, machineId, count }),
      ballots: Array.from({ length: count }, (_, i) => ({
        machineId,
        ballotStyle: "style-general",
        choices: { "contest-president": [["cand-a", "cand-b", "cand-c"][i % 3]!], "contest-measure-1": [i % 2 ? "no" : "yes"] },
      })),
    }),
    spoilExport: async ({ setId, trackingCode }) => json("spoil", { setId, trackingCode }),
    mismatchExport: async ({ setId, trackingCode }) => json("mismatch", { setId, trackingCode }),
    precinctCloseExport: async ({ setId, faults }) => json("precinct-close", { setId, faults }),
  };

  const receiptCalls: unknown[] = [];
  const receipts: ReceiptsPort = {
    available: true,
    receipt: async (spec) => {
      receiptCalls.push(spec);
      return new TextEncoder().encode(`RECEIPT\n${spec.countyName} ${spec.electionName}\nCast on ${spec.castDate}\n${spec.trackingCode}\n${spec.url}\n`);
    },
    paperBallot: async (spec) =>
      new TextEncoder().encode(`PAPER BALLOT\nMachine ${spec.machineId}\n${JSON.stringify(spec.choices)}\n`),
  };

  const registry: RegistryWriter = {
    insertPrecinct: async (row) => {
      if (precincts.has(row.id)) throw new ApiError(409, "precinct exists");
      precincts.set(row.id, { county_id: row.county_id, name: row.name });
    },
    insertMachine: async (row) => {
      if (machines.has(row.id)) throw new ApiError(409, "machine exists");
      if (!precincts.has(row.precinct_id)) throw new ApiError(409, "unknown precinct");
      machines.set(row.id, { precinct_id: row.precinct_id });
    },
  };

  const sink: FileSink = {
    write: async (path, contents) => {
      files.set(path, contents);
    },
  };

  return {
    api,
    simulator,
    receipts,
    registry,
    sink,
    /** Inspection only: copies, so a test can't change the stub's history. */
    events: () => events.map((e) => ({ ...e })),
    calls: () => [...calls],
    files,
    receiptCalls,
    precincts,
    machines,
    status: (code: string) => ballot(code).status,
    reason: (code: string) => ballot(code).reason,
  };
}

export type StubWorld = ReturnType<typeof stubWorld>;
