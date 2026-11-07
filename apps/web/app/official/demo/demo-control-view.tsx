import { LABELS } from "@vbt/demo";
import { publicLabel } from "@vbt/domain";
import { Card, CardContent } from "@vbt/ui/components/card";
import { inputVariants } from "@vbt/ui/components/input";
import { Label } from "@vbt/ui/components/label";
import { Table, TableBody, TableCell, TableHead, TableHeader } from "@vbt/ui/components/table";
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
    <div className="flex flex-col gap-6">
      <Card mode="admin">
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-56 flex-col gap-2">
              <Label htmlFor="demo-set-id">Demo set</Label>
              <input
                id="demo-set-id"
                data-testid="set-id"
                value={setId}
                disabled={view.phase !== "idle"}
                onChange={(e) => onSetId?.(e.target.value)}
                placeholder="demo-xxxxxx"
                spellCheck={false}
                className={inputVariants({ mode: "admin", variant: "code" })}
              />
            </div>
            {/* Plain classes: the start button's markup is asserted in run-view.test.tsx. */}
            <button
              type="button"
              data-testid="start"
              disabled={!enabled}
              onClick={() => enabled && onStart?.()}
              className={`vbt-button inline-flex min-h-9 items-center rounded-sm bg-brand-orange px-4 py-1 text-body font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${enabled ? "cursor-pointer" : "opacity-50"}`}
            >
              Start
            </button>
          </div>
      <p data-testid="phase" className="text-label uppercase text-ink-muted">{PHASE_TEXT[view.phase]}</p>
      <p data-testid="countdown" aria-live="polite" style={{ fontSize: "2rem", fontVariantNumeric: "tabular-nums" }}>
        {clock(secondsLeft(view, now))}
      </p>
      {view.message ? <p className="text-body text-status-discarded" data-testid="message" role="alert">{view.message}</p> : null}
        </CardContent>
      </Card>

      <Table data-testid="steps">
        <TableHeader>
          <tr>
            <TableHead>At</TableHead>
            <TableHead>Step</TableHead>
            <TableHead>Result</TableHead>
            {LABELS.map((l) => (
              <TableHead key={l}>{l}</TableHead>
            ))}
          </tr>
        </TableHeader>
        <TableBody>
          {view.steps.map((row) => (
            <tr key={row.id} data-testid={`step-${row.id}`} data-state={row.state}>
              <TableCell className="tabular-nums">{clock(row.at)}</TableCell>
              <TableCell>{row.title}</TableCell>
              <TableCell>
                {row.state === "pending" ? "…" : row.state === "ok" ? `ok at ${clock(row.ranAt ?? row.at)}` : `failed: ${row.error ?? ""}`}
                {row.fallback ? ` (fallback: ${row.fallback})` : ""}
              </TableCell>
              {LABELS.map((l) => (
                <TableCell key={l}>{row.statuses ? publicLabel(row.statuses[l]) : ""}</TableCell>
              ))}
            </tr>
          ))}
        </TableBody>
      </Table>

      {view.result ? (
        <p data-testid="result" className="text-body text-ink">
          {view.result.ok ? "All steps ok" : "The run stopped"} in {clock(view.result.finishedAt)}
          {view.result.overran ? " (over the 3:10 deadline)" : ""}.{" "}
          {LABELS.map((l) => `${l}: ${publicLabel(view.result!.statuses[l])}`).join(" · ")}
          {view.result.reasons.E ? ` · E's reason: ${view.result.reasons.E}` : ""}
        </p>
      ) : null}
    </div>
  );
}
