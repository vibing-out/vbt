"use client";

// The public tracker page body (T-08). Fetches GET /api/track/{code} at once and then polls it
// (lib/track/poller.ts). Shows dates only, never a time or any choice, and collects nothing but the code.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@vbt/ui/components/button";
import { Card, CardTitle } from "@vbt/ui/components/card";
import { Icon } from "@vbt/ui/components/icon";
import { StageTimeline, type OffPath, type StageEntry } from "@vbt/ui/components/stage-timeline";
import { StatusBadge } from "@vbt/ui/components/status-badge";
import { STAGES } from "@vbt/ui/status";
import {
  CHECK_TEXT,
  CIPHERTEXT_LINE,
  detailLine,
  NOT_FOUND_MESSAGE,
  RECEIPT_FOOTER,
  REFRESH_FAILED,
  REVIEW_ACCEPTED,
} from "../../lib/track/copy";
import { formatDisplayDate } from "../../lib/track/dates";
import { createPoller, documentVisibility } from "../../lib/track/poller";
import type { TrackResult, TrackStage } from "../../lib/track/types";

export type TrackerState =
  | { kind: "loading"; retrying: boolean }
  | { kind: "not_found" }
  | { kind: "ready"; data: TrackResult; stale: boolean };

export function Tracker({ code }: { code: string }) {
  const [state, setState] = useState<TrackerState>({ kind: "loading", retrying: false });

  useEffect(() => {
    const url = `/api/track/${encodeURIComponent(code)}`;
    const poller = createPoller({
      request: (signal) => fetch(url, { signal, cache: "no-store", headers: { Accept: "application/json" } }),
      visibility: documentVisibility(document),
      onData: (data) => setState({ kind: "ready", data, stale: false }),
      onNotFound: () => setState({ kind: "not_found" }),
      onRetrying: () =>
        setState((prev) =>
          prev.kind === "ready" ? { ...prev, stale: true } : prev.kind === "loading" ? { kind: "loading", retrying: true } : prev,
        ),
    });
    poller.start();
    return () => poller.stop();
  }, [code]);

  return <TrackerView code={code} state={state} />;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-03" → "Nov 3", for the timeline dots. Dates only, never a time of day. */
function shortDate(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const [, month, day] = iso.split("-").map(Number);
  return month && day ? `${MONTHS[month - 1]} ${day}` : undefined;
}

/** The four-dot StageTimeline for a lookup result, with challenged and discarded as off-path. */
function timelineProps(data: TrackResult): { stages: StageEntry[]; offPath?: OffPath } {
  const onPath = (STAGES as readonly string[]).includes(data.status);
  const stages: StageEntry[] = STAGES.flatMap((stage): StageEntry[] => {
    const entry = [...data.timeline].reverse().find((t) => t.status === stage);
    if (!entry) return [];
    return [{ stage, state: onPath && stage === data.status ? "current" : "done", date: shortDate(entry.date) }];
  });
  const last = data.timeline.at(-1);
  if (data.status === "CHALLENGED") return { stages, offPath: { status: "CHALLENGED", reason: last?.reason ?? "Under review" } };
  if (data.status === "DISCARDED") {
    return { stages, offPath: { status: "DISCARDED", reason: last?.reason ?? "Reason on file", date: shortDate(last?.date ?? null) } };
  }
  if (data.status === "SPOILED") return { stages, offPath: { status: "SPOILED" } };
  return { stages };
}

export function TrackerView({ code, state }: { code: string; state: TrackerState }) {
  return (
    <div className="min-h-dvh bg-surface">
      <header className="mx-auto flex max-w-[560px] items-center justify-between px-4 py-4">
        <Link href="/track" className="text-label uppercase text-ink focus-visible:outline-2 focus-visible:outline-offset-2">
          <span className="text-accent-text">●</span> Ballot tracker
        </Link>
      </header>
      <main data-testid="tracker" className="mx-auto flex max-w-[560px] flex-col gap-6 px-4 pb-12">
        {state.kind === "loading" && (
          <Card variant="hero">
            <p className="text-label uppercase text-on-inverse-muted">Ballot tracking code</p>
            <p data-testid="tracking-code" className="break-all font-mono text-code-lg text-on-inverse">{code}</p>
            <p role="status">{state.retrying ? REFRESH_FAILED : "Looking up this ballot…"}</p>
            <StageTimeline surface="hero" stages={[]} loading />
          </Card>
        )}

        {state.kind === "not_found" && (
          <Card>
            <p className="text-label uppercase text-ink-muted">Ballot tracking code</p>
            <p data-testid="tracking-code" className="break-all font-mono text-code-lg text-ink">{code}</p>
            <p role="alert" data-testid="not-found" className="text-body-lg text-ink">
              {NOT_FOUND_MESSAGE}
            </p>
          </Card>
        )}

        {state.kind === "ready" && <BallotJourney code={code} data={state.data} stale={state.stale} />}

        <div className="flex flex-col gap-3">
          {state.kind === "ready" && (
            <Button asChild className="w-full">
              <Link href={`/receipt/${code}`}>View the paper receipt</Link>
            </Button>
          )}
          <Button asChild variant="secondary" className="w-full">
            <Link href="/track">Track another code</Link>
          </Button>
        </div>
        <footer className="text-small text-ink-muted">{RECEIPT_FOOTER}</footer>
      </main>
    </div>
  );
}

function BallotJourney({ code, data, stale }: { code: string; data: TrackResult; stale: boolean }) {
  // Each published stage's check sits on the last timeline row for that stage.
  const lastIndex = new Map(data.timeline.map((entry, i) => [entry.status, i]));
  const stagesFor = (index: number): TrackStage[] =>
    data.stages.filter((s) => lastIndex.get(s.stage) === index);
  const allPassed = data.stages.length > 0 && data.stages.every((s) => s.check.state === "passed");

  return (
    <>
      <section aria-labelledby="current-status" className="flex flex-col gap-2">
        <StatusBadge status={data.status} className="self-start" />
        <h1 id="current-status" data-testid="current-status" className="text-display text-ink">
          {data.label}
        </h1>
        <p aria-live="polite" data-testid="live-status" className="text-body-lg text-ink-muted">
          Current status: {data.label}
        </p>
        {stale && (
          <p role="status" data-testid="refresh-failed" className="text-body text-status-challenged">
            {REFRESH_FAILED}
          </p>
        )}
      </section>

      <Card variant="hero">
        <div className="flex flex-col gap-1">
          <p className="text-label uppercase text-on-inverse-muted">Ballot tracking code</p>
          <p data-testid="tracking-code" className="break-all font-mono text-code-lg text-on-inverse">{code}</p>
          <p className="text-small text-on-inverse-muted">{data.precinct.name}</p>
        </div>
        <StageTimeline surface="hero" {...timelineProps(data)} />
      </Card>

      {allPassed && (
        <div className="flex items-start gap-3 text-body-lg text-ink">
          <Icon name="shield-check" />
          <p>Your encrypted ballot is unchanged and included in every published record.</p>
        </div>
      )}

      <Card aria-label="Stages and integrity checks">
        <CardTitle>Stages and integrity checks</CardTitle>
        <ol data-testid="timeline" className="flex flex-col gap-4">
          {data.timeline.map((entry, i) => {
            const date = formatDisplayDate(entry.date);
            const afterReview = i > 0 && data.timeline[i - 1]!.status === "CHALLENGED" && entry.status !== "DISCARDED";
            return (
              <li
                key={`${entry.status}-${i}`}
                data-testid="timeline-entry"
                data-status={entry.status}
                className="flex flex-col gap-1 border-l-2 border-line pl-4"
              >
                <h3 className="text-body-lg font-semibold text-ink">{entry.label}</h3>
                {date && <p className="text-small text-ink-muted">{date}</p>}
                <p className="text-body text-ink">{detailLine(entry.status, data)}</p>
                {afterReview && <p className="text-body text-ink">{REVIEW_ACCEPTED}</p>}
                {(entry.status === "CHALLENGED" || entry.status === "DISCARDED") && entry.reason && (
                  <p data-testid="reason" className="text-body font-semibold text-ink">
                    Reason: {entry.reason}
                  </p>
                )}
                {entry.status === "CAST" && (
                  <p data-testid="ciphertext" className="break-all text-small text-ink-muted">
                    {CIPHERTEXT_LINE}: <code className="font-mono">{data.ciphertextHash}</code>
                  </p>
                )}
                {stagesFor(i).map((stage) => (
                  <StageCheck key={`${stage.scope}-${stage.scopeId}-${stage.publishedOn ?? ""}`} stage={stage} />
                ))}
              </li>
            );
          })}
        </ol>
      </Card>

      <Card aria-label="What this means">
        <CardTitle>What this means</CardTitle>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-body text-ink">
          <li>This page shows where your ballot is, never how you voted or what time you voted.</li>
          <li>Sharing or photographing your receipt is safe. It proves nothing about your vote.</li>
          <li>The paper ballot in the ballot box is authoritative and decides any recount.</li>
        </ul>
      </Card>
    </>
  );
}

function StageCheck({ stage }: { stage: TrackStage }) {
  const published = formatDisplayDate(stage.publishedOn);
  const tone = stage.check.state === "failed" ? "text-status-discarded" : "text-ink";
  return (
    <div data-testid="stage-check" data-state={stage.check.state} className="mt-1 flex items-start gap-2 rounded-sm bg-surface-sunk p-3">
      {stage.check.state !== "unavailable" && (
        <span className={tone}>
          <Icon name={stage.check.state === "passed" ? "check" : "x"} size={16} />
        </span>
      )}
      <div className="flex min-w-0 flex-col">
        <p className={`text-body font-semibold ${tone}`}>
          {stage.check.state === "passed" ? "✓ " : stage.check.state === "failed" ? "✗ " : ""}
          {CHECK_TEXT[stage.check.state] ?? CHECK_TEXT.unavailable}
        </p>
        <p className="text-small text-ink-muted">
          Public record for {stage.scope} {stage.scopeId}
          {published ? `, published ${published}` : ""}
          {stage.recordUrl && (
            <>
              {" · "}
              <a href={stage.recordUrl} className="text-ink underline underline-offset-4">
                View the published record
              </a>
            </>
          )}
        </p>
        <p className="truncate font-mono text-small text-ink-muted" title={stage.merkleRoot}>
          Merkle root {stage.merkleRoot}
        </p>
      </div>
    </div>
  );
}
