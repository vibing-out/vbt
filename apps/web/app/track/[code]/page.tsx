import { Button } from "@vbt/ui/components/button";
import { Card, CardDescription, CardTitle } from "@vbt/ui/components/card";
import { CodeText } from "@vbt/ui/components/code-text";
import { Icon } from "@vbt/ui/components/icon";
import { StageTimeline, type OffPath, type StageEntry } from "@vbt/ui/components/stage-timeline";
import { StatusBadge } from "@vbt/ui/components/status-badge";
import { STAGES } from "@vbt/ui/status";
import Link from "next/link";
import { lookup, type TrackView } from "../../../lib/demo-election";
import { shortDate, TrackerShell } from "../shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ballot status · VBT" };

const EXPECTED: Record<string, string> = { REPORTED_UNOFFICIAL: "Nov 4", CERTIFIED: "Nov 18" };

function timelineProps(view: TrackView): { stages: StageEntry[]; offPath?: OffPath } {
  const reached = view.timeline.filter((t) => (STAGES as readonly string[]).includes(t.status));
  const last = reached.length - 1;
  const onPath = view.status !== "CHALLENGED" && view.status !== "DISCARDED";
  const stages: StageEntry[] = STAGES.map((stage) => {
    const i = reached.findIndex((t) => t.status === stage);
    if (i < 0) return { stage, state: "upcoming", expected: onPath ? EXPECTED[stage] : undefined };
    return { stage, state: onPath && i === last ? "current" : "done", date: shortDate(reached[i]!.date) };
  });
  if (view.status === "CHALLENGED") return { stages, offPath: { status: "CHALLENGED", reason: "A cross-check flagged this ballot's batch" } };
  if (view.status === "DISCARDED") {
    const at = view.timeline.find((t) => t.status === "DISCARDED");
    return { stages, offPath: { status: "DISCARDED", reason: view.reason ?? "Reason on file", date: at ? shortDate(at.date) : undefined } };
  }
  return { stages };
}

const NEXT_STEP: Record<string, string> = {
  CAST: "Next: counted at your precinct after polls close.",
  TALLIED_PRECINCT: "Next: included in Marion County's election-night results.",
  REPORTED_UNOFFICIAL: "Next: certified by the county, expected by Nov 18.",
  CERTIFIED: "Final: your ballot is part of the certified results.",
  CHALLENGED: "The county election board reviews it. The paper ballot decides.",
  DISCARDED: "This decision is final and recorded in the public record.",
};

export default async function BallotPage({ params }: { params: Promise<{ code: string }> }): Promise<React.JSX.Element> {
  const { code } = await params;
  const view = lookup(decodeURIComponent(code));
  if (!view) {
    return (
      <TrackerShell>
        <Card data-testid="track-unknown">
          <CardTitle>We couldn&apos;t find that code</CardTitle>
          <CardDescription>
            Check the code on your receipt and try again. Lost receipts can&apos;t be recovered, by design.
          </CardDescription>
          <Button asChild variant="secondary" className="w-full">
            <Link href="/track">Try another code</Link>
          </Button>
        </Card>
      </TrackerShell>
    );
  }
  const records = view.timeline.filter((t) => t.record);
  return (
    <TrackerShell>
      <div className="flex flex-col gap-2" data-testid="track-result">
        <StatusBadge status={view.status} className="self-start" />
        <h1 className="text-display text-ink" data-testid="status">
          {view.status === "DISCARDED" ? "Not counted" : view.statusLabel}
        </h1>
        <p className="text-body-lg text-ink-muted">
          {view.county} General Election · {view.precinct}
        </p>
      </div>
      <Card variant="hero">
        <div className="flex flex-col gap-1">
          <p className="text-label uppercase text-on-inverse-muted">Tracking code</p>
          <CodeText code={view.trackingCode} className="text-on-inverse" />
        </div>
        <StageTimeline surface="hero" {...timelineProps(view)} />
      </Card>
      <p className="text-body-lg text-ink" data-testid="next-step">
        {NEXT_STEP[view.status]}
      </p>
      <Card aria-label="Integrity check" data-testid="integrity">
        <div className="flex items-start gap-3">
          <span className={view.allChecksPass ? "text-ink" : "text-status-discarded"}>
            <Icon name={view.allChecksPass ? "shield-check" : "x"} />
          </span>
          <div className="flex flex-col gap-1">
            <CardTitle>
              {view.allChecksPass
                ? records.length
                  ? "Your encrypted ballot is unchanged and included in every published record"
                  : "Your encrypted ballot is recorded unchanged"
                : "An integrity check failed"}
            </CardTitle>
            <CardDescription>
              {records.length
                ? "Each check recomputes the stage record's Merkle root from your ballot's fingerprint."
                : "It is held out of the published totals, so it appears in no stage record."}
            </CardDescription>
          </div>
        </div>
        {records.length ? (
          <ul className="flex flex-col gap-3 border-t border-line pt-4">
            {records.map((t) => (
              <li key={t.status} className="flex items-start gap-3">
                <span className={t.record!.included ? "text-ink" : "text-status-discarded"}>
                  <Icon name={t.record!.included ? "check" : "x"} />
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="text-body text-ink">
                    {t.label} · {shortDate(t.date)}
                  </span>
                  <span className="text-small text-ink-muted">
                    {t.record!.included ? "Included" : "Not found"} in the {t.record!.scope} record ({t.record!.ballotCount} ballots)
                  </span>
                  <span className="truncate font-mono text-small text-ink-muted" title={t.record!.merkleRoot}>
                    Merkle root {t.record!.merkleRoot}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="break-all font-mono text-small text-ink-muted">Ballot fingerprint (SHA-256) {view.ciphertextHash}</p>
      </Card>
      <Card aria-label="What this means">
        <CardTitle>What this means</CardTitle>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-body text-ink">
          <li>This page shows where your ballot is, never how you voted or what time you voted.</li>
          <li>Sharing or photographing your receipt is safe. It proves nothing about your vote.</li>
          <li>The paper ballot in the ballot box is authoritative and decides any recount.</li>
          <li>Anyone can download each stage&apos;s public record and check it independently.</li>
        </ul>
      </Card>
      <div className="flex flex-col gap-3">
        <Button asChild className="w-full">
          <Link href={`/track/${view.trackingCode}/receipt`}>View the paper receipt</Link>
        </Button>
        <Button asChild variant="secondary" className="w-full">
          <Link href="/track">Track another ballot</Link>
        </Button>
      </div>
    </TrackerShell>
  );
}
