// The judges' 3-minute timeline (T-22). Pure: every effect goes through the ports and the injected clock;
// there is no Date.now, no timer and no I/O here.
//
//   0:20 spoil D                     upload D's spoil export                     D: SPOILED
//   0:45 precinct tally              upload precinct close (fault on E), batch   A B C: TALLIED_PRECINCT, E: CHALLENGED
//   1:30 election-night report       county batch                                A B C: REPORTED_UNOFFICIAL
//   2:00 reject E                    find E's challenge, resolve rejected        E: DISCARDED (reason shown)
//   2:40 certify                     county batch                                A B C: CERTIFIED
//
// Steps run at fixed offsets from the start, so a slow step never pushes later ones back; a late step runs
// at once. A failed step stops the run and nothing is retried: the set is spent, seed a fresh one. Output
// lines carry labels, statuses and offsets from the start, never a tracking code beside a time (locked
// Cross-checks privacy rule; no ordering leaks).

import type { BallotStatus } from "@vbt/domain";
import { LABELS, type Label, labelBallots, SET_SIZE } from "./labels.ts";
import { ApiError, type ApiPort, type BatchRequest, type Clock, type SimulatorPort } from "./ports.ts";
import { demoCountyId, demoPrecinctId } from "./set-id.ts";

export type StepId = "spoil-d" | "precinct-tally" | "election-night" | "reject-e" | "certify";

export interface StepSpec {
  readonly id: StepId;
  readonly title: string;
  /** Offset from the start, in seconds. */
  readonly at: number;
}

export const STEPS: readonly StepSpec[] = Object.freeze([
  { id: "spoil-d", title: "Spoil D", at: 20 },
  { id: "precinct-tally", title: "Precinct tally of A, B, C, E (machine fault on E)", at: 45 },
  { id: "election-night", title: "Election-night report", at: 90 },
  { id: "reject-e", title: "Reject E", at: 120 },
  { id: "certify", title: "Certify", at: 160 },
]);

/** The run must finish within 3 minutes 10 seconds. */
export const DEADLINE_SECONDS = 190;

/** Shown to voters on E's tracker page; exactly as the ticket words it. */
export const REJECT_REASON = "machine record did not match the paper ballot";

/** A step's new statuses must be readable on GET /api/track/{code} within this long of the write, so a
 * tracker page polling every 2 s or less (T-08, human decision 2) shows the change within 3 s. */
export const READBACK_MS = 1_000;
const READBACK_POLL_MS = 250;

export type Fallback = "spoil-unsupported";

export type StepError = "api" | "tracker-lag" | "unexpected-count" | "no-challenge" | "unexpected-status";

export type RunLine =
  | { readonly type: "started"; readonly setId: string; readonly deadline: number; readonly steps: readonly StepSpec[] }
  | {
      readonly type: "step";
      readonly id: StepId;
      readonly title: string;
      readonly at: number;
      /** Seconds from the start when the step finished. */
      readonly ranAt: number;
      readonly ok: true;
      readonly statuses: Readonly<Record<Label, BallotStatus>>;
      readonly fallback?: Fallback;
    }
  | {
      readonly type: "step";
      readonly id: StepId;
      readonly title: string;
      readonly at: number;
      readonly ranAt: number;
      readonly ok: false;
      readonly error: StepError;
      readonly message: string;
    }
  | {
      readonly type: "finished";
      readonly ok: boolean;
      readonly finishedAt: number;
      readonly overran: boolean;
      readonly statuses: Readonly<Record<Label, BallotStatus>>;
      readonly reasons: Readonly<Partial<Record<Label, string>>>;
      readonly fallback?: Fallback;
    };

export type RunResult = Extract<RunLine, { type: "finished" }>;

export interface CheckedSet {
  readonly setId: string;
  readonly precinctId: string;
  readonly countyId: string;
  readonly codes: Readonly<Record<Label, string>>;
}

export type SetCheck =
  | { readonly ok: true; readonly set: CheckedSet }
  | { readonly ok: false; readonly reason: "wrong-count" | "already-ran"; readonly message: string };

/**
 * Is this set ready for its one run? Exactly 5 ballots, all still CAST. Any other state means the set has
 * run (or started to) or isn't a demo set: refuse, because sets are never reset (ticket AC 7).
 */
export async function checkSet(api: Pick<ApiPort, "readSet">, setId: string): Promise<SetCheck> {
  const precinctId = demoPrecinctId(setId);
  const ballots = await api.readSet(precinctId);
  if (ballots.length !== SET_SIZE) {
    return { ok: false, reason: "wrong-count", message: `set ${setId} has ${ballots.length} ballots, not ${SET_SIZE}` };
  }
  if (ballots.some((b) => b.status !== "CAST")) {
    return { ok: false, reason: "already-ran", message: `set ${setId} has already run; seed a fresh set for each rehearsal` };
  }
  return {
    ok: true,
    set: { setId, precinctId, countyId: demoCountyId(setId), codes: labelBallots(ballots.map((b) => b.trackingCode)) },
  };
}

export interface RunInput {
  readonly api: ApiPort;
  readonly simulator: SimulatorPort;
  readonly clock: Clock;
  readonly set: CheckedSet;
  readonly onLine?: (line: RunLine) => void;
}

class StepFailure extends Error {
  readonly code: StepError;
  constructor(code: StepError, message: string) {
    super(message);
    this.code = code;
  }
}

/** True when the upload was refused because the endpoint doesn't take spoil events yet (ticket AC 8). */
export function isUnsupportedSpoil(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  const refused = (error.status >= 400 && error.status < 500) || error.status === 501;
  return refused && /SPOIL/i.test(error.message) && /unsupported|not supported|unknown event type/i.test(error.message);
}

const seconds = (ms: number) => Math.round(ms / 100) / 10;

/** Runs the fixed timeline once on a checked set. Resolves with the final line; never throws for a step. */
export async function runTimeline(input: RunInput): Promise<RunResult> {
  const { api, simulator, clock, set } = input;
  const emit = input.onLine ?? (() => {});
  const { codes, setId, precinctId, countyId } = set;
  const labelOf = new Map<string, Label>(LABELS.map((l) => [codes[l], l]));
  // Server messages may quote a tracking code; output shows the label instead.
  const redact = (text: string) => [...labelOf].reduce((t, [code, label]) => t.split(code).join(`<${label}>`), text);

  const expected: Record<Label, BallotStatus> = { A: "CAST", B: "CAST", C: "CAST", D: "CAST", E: "CAST" };
  const reasons: Partial<Record<Label, string>> = {};
  let fallback: Fallback | undefined;
  const counted = (): Label[] => (fallback ? ["A", "B", "C", "D"] : ["A", "B", "C"]);

  const start = clock.now();
  const offset = () => clock.now() - start;
  emit({ type: "started", setId, deadline: DEADLINE_SECONDS, steps: STEPS });

  /** Waits until GET /api/track shows what we expect for these ballots, for at most READBACK_MS. */
  const readBack = async (labels: readonly Label[]) => {
    const until = clock.now() + READBACK_MS;
    for (;;) {
      const views = await Promise.all(labels.map((l) => api.readTrack(codes[l])));
      const behind = labels.filter((l, i) => {
        const view = views[i]!;
        return view.status !== expected[l] || (reasons[l] !== undefined && view.reason !== reasons[l]);
      });
      if (behind.length === 0) return;
      if (clock.now() >= until) {
        throw new StepFailure("tracker-lag", `the tracker did not show ${behind.join(", ")} as expected within ${READBACK_MS} ms`);
      }
      await clock.sleepUntil(Math.min(clock.now() + READBACK_POLL_MS, until));
    }
  };

  const batch = async (request: Omit<BatchRequest, "scopeId">, scopeId: string) => {
    const labels = counted();
    const result = await api.createBatch({ ...request, scopeId });
    if (result.count !== labels.length) {
      throw new StepFailure("unexpected-count", `the ${request.to} batch moved ${result.count} ballots, expected ${labels.length}`);
    }
    for (const l of labels) expected[l] = request.to;
    await readBack(labels);
  };

  const challengeOf = async (label: Label) => {
    const found = (await api.listMismatches(countyId)).filter((m) => m.trackingCode === codes[label]);
    if (found.length !== 1) throw new StepFailure("no-challenge", `expected one open challenge for ${label}, found ${found.length}`);
    return found[0]!.challengeId;
  };

  const resolve = async (label: Label, resolution: Parameters<ApiPort["resolveChallenge"]>[1], to: BallotStatus) => {
    const { status } = await api.resolveChallenge(await challengeOf(label), resolution);
    if (status !== to) throw new StepFailure("unexpected-status", `resolving ${label}'s challenge left it ${status}, expected ${to}`);
    expected[label] = to;
    if (resolution.resolution === "rejected") reasons[label] = resolution.reason;
    await readBack([label]);
  };

  const actions: Record<StepId, () => Promise<void>> = {
    "spoil-d": async () => {
      try {
        await api.uploadEventsFile(await simulator.spoilExport({ setId, trackingCode: codes.D }));
      } catch (error) {
        if (!isUnsupportedSpoil(error)) throw error;
        // SPOILED isn't taken yet: challenge D through a machine/paper mismatch and accept it, so D is
        // back to CAST before the precinct tally and is certified with A to C.
        fallback = "spoil-unsupported";
        await api.uploadEventsFile(await simulator.mismatchExport({ setId, trackingCode: codes.D }));
        expected.D = "CHALLENGED";
        await readBack(["D"]);
        await resolve("D", { resolution: "accepted" }, "CAST");
        return;
      }
      expected.D = "SPOILED";
      await readBack(["D"]);
    },
    "precinct-tally": async () => {
      // E is challenged only by the fault in the precinct-close file (an automatic mismatch); the batch
      // then moves the ballots still CAST.
      await api.uploadEventsFile(await simulator.precinctCloseExport({ setId, faults: [codes.E] }));
      expected.E = "CHALLENGED";
      await readBack(["E"]);
      await batch({ scope: "precinct", from: "CAST", to: "TALLIED_PRECINCT" }, precinctId);
    },
    "election-night": () => batch({ scope: "county", from: "TALLIED_PRECINCT", to: "REPORTED_UNOFFICIAL" }, countyId),
    "reject-e": () => resolve("E", { resolution: "rejected", reason: REJECT_REASON }, "DISCARDED"),
    certify: () => batch({ scope: "county", from: "REPORTED_UNOFFICIAL", to: "CERTIFIED" }, countyId),
  };

  const finish = (ok: boolean): RunResult => {
    const finishedAt = seconds(offset());
    const line: RunResult = {
      type: "finished",
      ok,
      finishedAt,
      overran: finishedAt > DEADLINE_SECONDS,
      statuses: { ...expected },
      reasons: { ...reasons },
      ...(fallback ? { fallback } : {}),
    };
    emit(line);
    return line;
  };

  for (const step of STEPS) {
    await clock.sleepUntil(start + step.at * 1000);
    try {
      await actions[step.id]();
    } catch (error) {
      const code: StepError = error instanceof StepFailure ? error.code : "api";
      const message = redact(error instanceof Error ? error.message : String(error));
      emit({ type: "step", id: step.id, title: step.title, at: step.at, ranAt: seconds(offset()), ok: false, error: code, message });
      return finish(false);
    }
    emit({
      type: "step",
      id: step.id,
      title: step.title,
      at: step.at,
      ranAt: seconds(offset()),
      ok: true,
      statuses: { ...expected },
      ...(step.id === "spoil-d" && fallback ? { fallback } : {}),
    });
  }
  return finish(true);
}
