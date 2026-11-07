// Orders one ballot's public events by following its own hash chain (prev_hash → previous hash),
// starting from the event with prev_hash = null (CAST). The chain is the ballot's own history, not a
// timestamp, so nothing here reveals order across ballots (locked principle 5). No hashing happens
// here: verifying the chain belongs to packages/events and the verifier (T-15).

import { type BallotStatus, isBallotStatus, publicLabel } from "./status.ts";
import { PUBLISHED_STAGES } from "./transition.ts";

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

/** One row of a ballot's public timeline. */
export interface TrackTimelineEntry {
  status: BallotStatus;
  label: string;
  /** A "YYYY-MM-DD" date, or null. Never a time of day. */
  date: string | null;
  /** Shown only for CHALLENGED and DISCARDED; see publicReason. */
  reason: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDay(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value);
}

/**
 * The reason a voter may see. Only a challenge or a discard discloses its reason, and a blank one
 * shows as none. Every other status shows no reason.
 */
export function publicReason(status: BallotStatus, reason: string | null): string | null {
  return status === "CHALLENGED" || status === "DISCARDED" ? reason?.trim() || null : null;
}

/** The rank of a published stage in the tracker's stage list; unpublished stages sort last. */
export function stageOrder(stage: BallotStatus): number {
  const index = PUBLISHED_STAGES.indexOf(stage);
  return index === -1 ? 99 : index;
}

/**
 * Sorts stage records by stage order, then publication date. Never by time of day. Returns a new
 * array.
 */
export function sortStageRecords<T extends { stage: BallotStatus; publishedOn: string | null }>(
  records: readonly T[],
): T[] {
  return [...records].sort(
    (a, b) => stageOrder(a.stage) - stageOrder(b.stage) || (a.publishedOn ?? "").localeCompare(b.publishedOn ?? ""),
  );
}

/**
 * A ballot's public timeline: the CAST entry, then each event that moved the ballot to a status, in
 * chain order. The CAST date is the cast date when known, else the CAST event's date.
 */
export function buildTrackTimeline(events: readonly PublicEvent[], castDate: string | null): TrackTimelineEntry[] {
  const { events: ordered } = orderByChain(events);

  const entry = (status: BallotStatus, date: string | null, reason: string | null): TrackTimelineEntry => ({
    status,
    label: publicLabel(status),
    date: isDay(date) ? date : null,
    reason: publicReason(status, reason),
  });

  const castEvent = ordered.find((e) => e.event_type === "CAST");
  const timeline: TrackTimelineEntry[] = [entry("CAST", castDate ?? castEvent?.occurred_on ?? null, null)];
  for (const e of ordered) {
    // CAST is the entry above. A MISMATCH_DETECTED flag with no status shows only through the
    // CHALLENGED transition it creates.
    if (e.event_type === "CAST" || !isBallotStatus(e.to_status) || e.to_status === "CAST") continue;
    timeline.push(entry(e.to_status, e.occurred_on, e.reason));
  }
  return timeline;
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
