import { LABELS } from "@vbt/demo";
import { publicLabel } from "@vbt/domain";
import { tokens } from "@vbt/ui";
import { canStart, clock, type RunView, secondsLeft } from "./run-view";

// Demo control's markup, from the view state alone, so it renders the same on the server and in tests.

export interface DemoControlViewProps {
  readonly view: RunView;
  readonly setId: string;
  readonly now: number;
  readonly onSetId?: (value: string) => void;
  readonly onStart?: () => void;
}

const PHASE_TEXT: Record<RunView["phase"], string> = {
  idle: "Ready. Press Start once; a set runs only once.",
  starting: "Starting…",
  running: "Running",
  finished: "Finished",
  refused: "Refused",
  error: "Stopped",
};

export function DemoControlView({ view, setId, now, onSetId, onStart }: DemoControlViewProps) {
  const enabled = canStart(view, setId);
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: tokens.space.lg, maxWidth: 880 }}>
      <h1>Demo control</h1>
      <p>Official tools · judges&apos; 3-minute demo. Seed a fresh set with <code>demo seed</code> for each rehearsal.</p>

      <label>
        Demo set{" "}
        <input
          data-testid="set-id"
          value={setId}
          disabled={view.phase !== "idle"}
          onChange={(e) => onSetId?.(e.target.value)}
          placeholder="demo-xxxxxx"
          spellCheck={false}
        />
      </label>{" "}
      <button type="button" data-testid="start" disabled={!enabled} onClick={() => enabled && onStart?.()}>
        Start
      </button>

      <p data-testid="phase">{PHASE_TEXT[view.phase]}</p>
      <p data-testid="countdown" aria-live="polite" style={{ fontSize: "2rem", fontVariantNumeric: "tabular-nums" }}>
        {clock(secondsLeft(view, now))}
      </p>
      {view.message ? <p data-testid="message" role="alert">{view.message}</p> : null}

      <table data-testid="steps">
        <thead>
          <tr>
            <th>At</th>
            <th>Step</th>
            <th>Result</th>
            {LABELS.map((l) => (
              <th key={l}>{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.steps.map((row) => (
            <tr key={row.id} data-testid={`step-${row.id}`} data-state={row.state}>
              <td>{clock(row.at)}</td>
              <td>{row.title}</td>
              <td>
                {row.state === "pending" ? "…" : row.state === "ok" ? `ok at ${clock(row.ranAt ?? row.at)}` : `failed: ${row.error ?? ""}`}
                {row.fallback ? ` (fallback: ${row.fallback})` : ""}
              </td>
              {LABELS.map((l) => (
                <td key={l}>{row.statuses ? publicLabel(row.statuses[l]) : ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {view.result ? (
        <p data-testid="result">
          {view.result.ok ? "All steps ok" : "The run stopped"} in {clock(view.result.finishedAt)}
          {view.result.overran ? " (over the 3:10 deadline)" : ""}.{" "}
          {LABELS.map((l) => `${l}: ${publicLabel(view.result!.statuses[l])}`).join(" · ")}
          {view.result.reasons.E ? ` · E's reason: ${view.result.reasons.E}` : ""}
        </p>
      ) : null}
    </main>
  );
}
