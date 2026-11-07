import "server-only";

// Demo fallback for the public tracker: when a code isn't in the database, answer from the fixture
// election in lib/demo-election.ts, in the same TrackResult shape the real lookup returns. Keeps the
// judges' demo codes working whatever the production database holds. Remove once seed data covers
// the demo.
import { isTerminal } from "@vbt/domain";
import { lookup } from "../demo-election";
import { lookupBallot } from "./lookup";
import type { TrackResult } from "./types";

export function demoTrackResult(code: string): TrackResult | null {
  const view = lookup(code);
  if (!view) return null;
  return {
    trackingCode: view.trackingCode,
    status: view.status,
    label: view.statusLabel,
    terminal: isTerminal(view.status),
    ciphertextHash: view.ciphertextHash,
    castDate: view.timeline[0]?.date ?? null,
    precinct: { id: view.precinct.toLowerCase().replace(/\s+/g, "-"), name: view.precinct, countyId: "18097" },
    timeline: view.timeline.map((t) => ({
      status: t.status,
      label: t.label,
      date: t.date,
      reason: t.status === "DISCARDED" || t.status === "CHALLENGED" ? (view.reason ?? null) : null,
    })),
    stages: view.timeline.flatMap((t) =>
      t.record
        ? [
            {
              stage: t.status,
              scope: t.status === "TALLIED_PRECINCT" ? ("precinct" as const) : ("county" as const),
              scopeId: t.record.scope,
              merkleRoot: t.record.merkleRoot,
              signature: null,
              publishedOn: t.date,
              recordUrl: null,
              check: { state: t.record.included ? ("passed" as const) : ("failed" as const), proof: null },
            },
          ]
        : [],
    ),
  };
}

/** The database first, then the demo election. */
export async function lookupWithDemoFallback(code: string): Promise<TrackResult | null> {
  return (await lookupBallot(code)) ?? demoTrackResult(code);
}
