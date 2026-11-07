import type { BallotStatus } from "@vbt/domain";
import { DEADLINE_SECONDS, type Label, type RunLine, type RunResult, STEPS, type StepId } from "@vbt/demo";

// Demo control's view state, as a pure reducer over the route's NDJSON lines (T-22). Start can be pressed
// once per page load (human decision 1 on #49): after it, the phase never returns to idle.

export type Phase = "idle" | "starting" | "running" | "finished" | "refused" | "error";

export interface StepRow {
  readonly id: StepId;
  readonly title: string;
  readonly at: number;
  readonly state: "pending" | "ok" | "failed";
  readonly ranAt?: number;
  readonly statuses?: Readonly<Record<Label, BallotStatus>>;
  readonly error?: string;
  readonly fallback?: string;
}

export interface RunView {
  readonly phase: Phase;
  readonly setId: string | null;
  readonly steps: readonly StepRow[];
  readonly deadline: number;
  /** Local time (ms, the page's own clock) when the started line arrived; drives the countdown only. */
  readonly startedAt: number | null;
  readonly result: RunResult | null;
  readonly message: string | null;
}

export type RunAction =
  | { readonly type: "start"; readonly setId: string }
  | { readonly type: "line"; readonly line: RunLine; readonly now: number }
  | { readonly type: "refused"; readonly status: number; readonly message: string }
  | { readonly type: "error"; readonly message: string };

const pending = (): StepRow[] => STEPS.map((s) => ({ id: s.id, title: s.title, at: s.at, state: "pending" }));

export const initialView: RunView = {
  phase: "idle",
  setId: null,
  steps: pending(),
  deadline: DEADLINE_SECONDS,
  startedAt: null,
  result: null,
  message: null,
};

export function reduce(view: RunView, action: RunAction): RunView {
  switch (action.type) {
    case "start":
      // Start counts once: a second press (or a double click) changes nothing.
      return view.phase === "idle" ? { ...view, phase: "starting", setId: action.setId } : view;
    case "refused":
      return { ...view, phase: "refused", message: action.message };
    case "error":
      return view.phase === "finished" ? view : { ...view, phase: "error", message: action.message };
    case "line": {
      const { line } = action;
      if (line.type === "started") {
        return { ...view, phase: "running", deadline: line.deadline, startedAt: action.now };
      }
      if (line.type === "step") {
        const steps = view.steps.map((row): StepRow => {
          if (row.id !== line.id) return row;
          return line.ok
            ? { ...row, state: "ok", ranAt: line.ranAt, statuses: line.statuses, ...(line.fallback ? { fallback: line.fallback } : {}) }
            : { ...row, state: "failed", ranAt: line.ranAt, error: `${line.error}: ${line.message}` };
        });
        return { ...view, steps };
      }
      return { ...view, phase: "finished", result: line };
    }
  }
}

/** Start is enabled only before the first press, and only for a well-formed set id. */
export function canStart(view: RunView, setId: string): boolean {
  return view.phase === "idle" && /^demo-[a-z2-7]{6}$/.test(setId.trim());
}

/** Whole seconds left before the 3:10 deadline. Frozen once the run has finished. */
export function secondsLeft(view: RunView, now: number): number {
  if (view.result) return Math.max(0, Math.ceil(view.deadline - view.result.finishedAt));
  if (view.startedAt === null) return view.deadline;
  return Math.max(0, Math.ceil(view.deadline - (now - view.startedAt) / 1000));
}

/** m:ss, for the countdown and step offsets. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Splits a chunked NDJSON stream into lines; returns the complete lines and the unfinished rest. */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((p) => p.trim() !== ""), rest };
}
