"use client";

// The public tracker page body (T-08). Fetches GET /api/track/{code} at once and then polls it
// (lib/track/poller.ts). Shows dates only, never a time or any choice, and collects nothing but the code.
import Link from "next/link";
import { useEffect, useState } from "react";
import { tokens } from "@vbt/ui";
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

const muted = { color: tokens.color.muted } as const;

export function TrackerView({ code, state }: { code: string; state: TrackerState }) {
  return (
    <main
      data-testid="tracker"
      style={{
        fontFamily: tokens.font.body,
        color: tokens.color.text,
        padding: tokens.space.md,
        maxWidth: "36rem",
        margin: "0 auto",
        lineHeight: 1.5,
      }}
    >
      <p style={{ ...muted, margin: 0 }}>Ballot tracking code</p>
      <p data-testid="tracking-code" style={{ fontWeight: 700, fontSize: "1.25rem", margin: 0, wordBreak: "break-all" }}>
        {code}
      </p>

      {state.kind === "loading" && (
        <p role="status">{state.retrying ? REFRESH_FAILED : "Looking up this ballot…"}</p>
      )}

      {state.kind === "not_found" && (
        <p role="alert" data-testid="not-found">
          {NOT_FOUND_MESSAGE}
        </p>
      )}

      {state.kind === "ready" && <BallotJourney data={state.data} stale={state.stale} />}

      <p style={{ marginTop: tokens.space.lg }}>
        <Link href="/track" style={{ color: tokens.color.accent }}>
          Track another code
        </Link>
      </p>
      <footer style={{ ...muted, borderTop: `1px solid ${tokens.color.muted}`, paddingTop: tokens.space.sm }}>
        {RECEIPT_FOOTER}
      </footer>
    </main>
  );
}

function BallotJourney({ data, stale }: { data: TrackResult; stale: boolean }) {
  // Each published stage's check sits on the last timeline row for that stage.
  const lastIndex = new Map(data.timeline.map((entry, i) => [entry.status, i]));
  const stagesFor = (index: number): TrackStage[] =>
    data.stages.filter((s) => lastIndex.get(s.stage) === index);

  return (
    <section aria-labelledby="current-status">
      <h1 id="current-status" data-testid="current-status" style={{ color: tokens.color.accent, fontSize: "1.5rem" }}>
        {data.label}
      </h1>
      <p aria-live="polite" data-testid="live-status" style={muted}>
        Current status: {data.label}
      </p>
      {stale && (
        <p role="status" data-testid="refresh-failed">
          {REFRESH_FAILED}
        </p>
      )}

      <ol data-testid="timeline" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {data.timeline.map((entry, i) => {
          const date = formatDisplayDate(entry.date);
          const afterReview = i > 0 && data.timeline[i - 1]!.status === "CHALLENGED" && entry.status !== "DISCARDED";
          return (
            <li
              key={`${entry.status}-${i}`}
              data-testid="timeline-entry"
              data-status={entry.status}
              style={{ borderLeft: `3px solid ${tokens.color.accent}`, paddingLeft: tokens.space.md, marginBottom: tokens.space.md }}
            >
              <h2 style={{ fontSize: "1.1rem", margin: 0 }}>{entry.label}</h2>
              {date && <p style={{ ...muted, margin: 0 }}>{date}</p>}
              <p style={{ margin: 0 }}>{detailLine(entry.status, data)}</p>
              {afterReview && <p style={{ margin: 0 }}>{REVIEW_ACCEPTED}</p>}
              {(entry.status === "CHALLENGED" || entry.status === "DISCARDED") && entry.reason && (
                <p data-testid="reason" style={{ margin: 0 }}>
                  Reason: {entry.reason}
                </p>
              )}
              {entry.status === "CAST" && (
                <p data-testid="ciphertext" style={{ margin: 0, wordBreak: "break-all" }}>
                  {CIPHERTEXT_LINE}: <code>{data.ciphertextHash}</code>
                </p>
              )}
              {stagesFor(i).map((stage) => (
                <StageCheck key={`${stage.scope}-${stage.scopeId}-${stage.publishedOn ?? ""}`} stage={stage} />
              ))}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StageCheck({ stage }: { stage: TrackStage }) {
  const published = formatDisplayDate(stage.publishedOn);
  return (
    <div data-testid="stage-check" data-state={stage.check.state} style={{ marginTop: tokens.space.sm }}>
      <p style={{ margin: 0, fontWeight: 600 }}>
        {stage.check.state === "passed" ? "✓ " : stage.check.state === "failed" ? "✗ " : ""}
        {CHECK_TEXT[stage.check.state] ?? CHECK_TEXT.unavailable}
      </p>
      <p style={{ ...muted, margin: 0 }}>
        Public record for {stage.scope} {stage.scopeId}
        {published ? `, published ${published}` : ""}
        {stage.recordUrl && (
          <>
            {" · "}
            <a href={stage.recordUrl} style={{ color: tokens.color.accent }}>
              View the published record
            </a>
          </>
        )}
      </p>
    </div>
  );
}
