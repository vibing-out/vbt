import { type RunLine, STEPS } from "@vbt/demo";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { DemoControlView } from "./demo-control-view";
import { canStart, clock, initialView, reduce, type RunAction, type RunView, secondsLeft, splitLines } from "./run-view";

// AC 6: Demo control starts a run on a chosen set, shows a countdown and each step's result. Human decision 1:
// Start is disabled once pressed.

const SET = "demo-k2mzqa";
const statuses = { A: "TALLIED_PRECINCT", B: "TALLIED_PRECINCT", C: "TALLIED_PRECINCT", D: "SPOILED", E: "CHALLENGED" } as const;
const started: RunLine = { type: "started", setId: SET, deadline: 190, steps: STEPS };
const line = (l: RunLine, now = 0): RunAction => ({ type: "line", line: l, now });
const play = (...actions: RunAction[]) => actions.reduce<RunView>(reduce, initialView);
const html = (view: RunView, now = 0, setId = SET) => renderToStaticMarkup(<DemoControlView view={view} setId={setId} now={now} />);
const startButton = (markup: string) => /<button[^>]*data-testid="start"[^>]*>/.exec(markup)![0];

describe("Start", () => {
  test("is enabled for a well-formed set before it is pressed, and never after", () => {
    expect(canStart(initialView, SET)).toBe(true);
    expect(canStart(initialView, "")).toBe(false);
    expect(canStart(initialView, "18097")).toBe(false);
    const pressed = play({ type: "start", setId: SET });
    expect(pressed.phase).toBe("starting");
    expect(canStart(pressed, SET)).toBe(false);
    // Still disabled once the run ends, is refused or errors: a set runs once.
    for (const view of [
      play({ type: "start", setId: SET }, line(started), line({ type: "finished", ok: true, finishedAt: 160, overran: false, statuses, reasons: {} })),
      play({ type: "start", setId: SET }, { type: "refused", status: 409, message: "already ran" }),
      play({ type: "start", setId: SET }, { type: "error", message: "lost" }),
    ]) {
      expect(canStart(view, SET)).toBe(false);
    }
  });

  test("a second press changes nothing", () => {
    const once = play({ type: "start", setId: SET });
    expect(reduce(once, { type: "start", setId: "demo-aaaaaa" })).toBe(once);
  });

  test("renders disabled after one click, along with the set field", () => {
    expect(startButton(html(initialView))).not.toContain("disabled");
    const markup = html(play({ type: "start", setId: SET }));
    expect(startButton(markup)).toContain("disabled");
    expect(markup).toMatch(/<input[^>]*data-testid="set-id"[^>]*disabled/);
  });
});

describe("countdown", () => {
  test("counts down from 3:10 from the started line, on the page's own clock", () => {
    expect(secondsLeft(initialView, 0)).toBe(190);
    const view = play({ type: "start", setId: SET }, line(started, 10_000));
    expect(secondsLeft(view, 10_000)).toBe(190);
    expect(secondsLeft(view, 10_000 + 45_000)).toBe(145);
    expect(secondsLeft(view, 10_000 + 500_000)).toBe(0);
    expect(html(view, 10_000 + 70_000)).toContain('data-testid="countdown" aria-live="polite" style="font-size:2rem;font-variant-numeric:tabular-nums">2:00<');
  });

  test("a started line that arrives with the first step still counts from the run's start", () => {
    // The route holds its first lines until the 0:20 step has run, then sends them together.
    const spoiled = { type: "step", id: "spoil-d", title: "Spoil D", at: 20, ranAt: 20, ok: true, statuses } as const;
    const view = play({ type: "start", setId: SET }, line(started, 30_000), line(spoiled, 30_000));
    expect(secondsLeft(view, 30_000)).toBe(170);
    // A later step a little behind on the network doesn't move the start forward.
    const later = reduce(view, line({ ...spoiled, id: "precinct-tally", at: 45, ranAt: 45 }, 30_000 + 25_400));
    expect(secondsLeft(later, 30_000 + 25_400)).toBe(145);
  });

  test("freezes at the finish", () => {
    const view = play(
      { type: "start", setId: SET },
      line(started, 0),
      line({ type: "finished", ok: true, finishedAt: 160.4, overran: false, statuses, reasons: {} }),
    );
    expect(secondsLeft(view, 999_999)).toBe(30);
    expect(clock(30)).toBe("0:30");
    expect(clock(190)).toBe("3:10");
  });
});

describe("step rows follow the stream", () => {
  test("pending, then ok with each ballot's public label, or failed with the error", () => {
    const ok = play(
      { type: "start", setId: SET },
      line(started),
      line({ type: "step", id: "spoil-d", title: "Spoil D", at: 20, ranAt: 20.2, ok: true, statuses: { ...statuses, A: "CAST", B: "CAST", C: "CAST", E: "CAST" } }),
      line({ type: "step", id: "precinct-tally", title: "t", at: 45, ranAt: 45.3, ok: false, error: "tracker-lag", message: "E late" }),
    );
    expect(ok.steps.map((s) => s.state)).toEqual(["ok", "failed", "pending", "pending", "pending"]);
    const markup = html(ok);
    expect(markup).toMatch(/data-testid="step-spoil-d" data-state="ok">.*ok at 0:20.*Spoiled by voter to check the machine; not counted/);
    expect(markup).toMatch(/data-testid="step-precinct-tally" data-state="failed">.*failed: tracker-lag: E late/);
  });

  test("the result shows the final public labels and E's reason", () => {
    const view = play(
      { type: "start", setId: SET },
      line(started),
      line({
        type: "finished",
        ok: true,
        finishedAt: 160,
        overran: false,
        statuses: { A: "CERTIFIED", B: "CERTIFIED", C: "CERTIFIED", D: "SPOILED", E: "DISCARDED" },
        reasons: { E: "machine record did not match the paper ballot" },
      }),
    );
    const markup = html(view);
    expect(markup).toContain("A: Included in certified results");
    expect(markup).toContain("E: Not counted (reason shown)");
    expect(markup).toContain("E&#x27;s reason: machine record did not match the paper ballot");
  });

  test("a refusal is shown", () => {
    expect(html(play({ type: "start", setId: SET }, { type: "refused", status: 409, message: "set has already run" }))).toMatch(
      /role="alert">set has already run</,
    );
  });

  test("splitLines keeps an unfinished line for the next chunk", () => {
    expect(splitLines('{"a":1}\n{"b"')).toEqual({ lines: ['{"a":1}'], rest: '{"b"' });
    expect(splitLines('{"a":1}\n\n')).toEqual({ lines: ['{"a":1}'], rest: "" });
  });
});
