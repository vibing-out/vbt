// Orders one ballot's public events by following its own hash chain (prev_hash → previous hash),
// starting from the event with prev_hash = null (CAST). The chain is the ballot's own history, not a
// timestamp, so nothing here reveals order across ballots (locked principle 5). No hashing happens
// here: verifying the chain belongs to packages/events and the verifier (T-15).

import { type BallotStatus, isBallotStatus } from "./status.ts";

/** One public ballot event, as the tracker reads it from ballot_event_public. */
export interface PublicEvent {
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  occurred_on: string | null;
  prev_hash: string | null;
  hash: string;
}

/**
 * Fallback display order when the chain can't be followed (missing root, fork, gap or cycle). Rows
 * arrive in hash order, which is not temporal, so a stable sort on this rank leaks nothing.
 */
export const FALLBACK_RANK: Readonly<Record<BallotStatus, number>> = Object.freeze({
  CAST: 0,
  SPOILED: 1,
  TALLIED_PRECINCT: 2,
  REPORTED_UNOFFICIAL: 3,
  CERTIFIED: 4,
  CHALLENGED: 5,
  DISCARDED: 6,
});

function eventRank(event: PublicEvent): number {
  if (event.event_type === "CAST") return -1;
  return isBallotStatus(event.to_status) ? FALLBACK_RANK[event.to_status] : 99;
}

/** The events in chain order; state-machine order if the chain is broken. */
export function orderByChain(events: readonly PublicEvent[]): { events: PublicEvent[]; chained: boolean } {
  const fallback = () => ({
    events: [...events].sort((a, b) => eventRank(a) - eventRank(b)),
    chained: false,
  });
  if (events.length === 0) return { events: [], chained: true };

  const roots = events.filter((e) => e.prev_hash === null);
  if (roots.length !== 1) return fallback();

  const byPrev = new Map<string, PublicEvent>();
  for (const e of events) {
    if (e.prev_hash === null) continue;
    if (byPrev.has(e.prev_hash)) return fallback(); // a fork
    byPrev.set(e.prev_hash, e);
  }

  const ordered: PublicEvent[] = [];
  const seen = new Set<string>();
  let current: PublicEvent | undefined = roots[0];
  while (current) {
    if (seen.has(current.hash)) return fallback(); // a cycle
    seen.add(current.hash);
    ordered.push(current);
    current = byPrev.get(current.hash);
  }
  return ordered.length === events.length ? { events: ordered, chained: true } : fallback();
}
