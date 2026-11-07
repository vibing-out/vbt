// The per-ballot SHA-256 event chain (locked principle 4, T-05 C8 and C9).
//
// hash = lowercase hex SHA-256 of the UTF-8 canonical JSON (sorted keys, no whitespace) of exactly
//   {v: 1, tracking_code, event_type, from_status, to_status, reason, occurred_on, prev_hash}
// The first event of a ballot has prev_hash null; every later one carries its predecessor's hash.
//
// Every input is publicly readable (ballot_public.tracking_code and ballot_event_public), so anyone
// can recompute a chain (locked principle 2). occurred_at, recorded_at, actor and batch are never
// inputs: a time of day in the hash could be brute-forced back out of it (principle 5).

import { type BallotStatus, isBallotStatus } from "@vbt/domain";
import { canonicalJson } from "./canonical.ts";
import { isIsoDate } from "./date.ts";
import { type EventType, isEventType } from "./event-types.ts";
import { isSha256Hex, sha256Hex } from "./hash.ts";

/** Locked event schema: ballot_events.actor_role. */
export const ACTOR_ROLES = Object.freeze(["machine", "poll_worker", "county", "state", "simulator"] as const);

export type ActorRole = (typeof ACTOR_ROLES)[number];

/** Version of the hash input. A new encoding gets a new number; old chains keep verifying. */
export const CHAIN_VERSION = 1;

/** The fields an event's hash covers. */
export type ChainFields = {
  tracking_code: string;
  event_type: EventType;
  from_status: BallotStatus | null;
  to_status: BallotStatus | null;
  reason: string | null;
  /** Indiana date of the event, YYYY-MM-DD (ballot_events.occurred_on). */
  occurred_on: string;
  prev_hash: string | null;
};

export type ChainedEvent = ChainFields & { hash: string };

function statusOrNull(value: unknown): value is BallotStatus | null {
  return value === null || isBallotStatus(value);
}

/** The exact string that is hashed. Throws on a field outside the schema. */
export function eventHashInput(event: ChainFields): string {
  const { tracking_code, event_type, from_status, to_status, reason, occurred_on, prev_hash } = event;
  if (typeof tracking_code !== "string" || tracking_code === "") throw new TypeError("tracking_code must be a non-empty string");
  if (!isEventType(event_type)) throw new TypeError("event_type is not a locked event type");
  if (!statusOrNull(from_status) || !statusOrNull(to_status)) throw new TypeError("from_status and to_status must be a status or null");
  if (reason !== null && typeof reason !== "string") throw new TypeError("reason must be a string or null");
  if (!isIsoDate(occurred_on)) throw new TypeError("occurred_on must be YYYY-MM-DD");
  if (prev_hash !== null && !isSha256Hex(prev_hash)) throw new TypeError("prev_hash must be 64 lowercase hex characters or null");
  return canonicalJson({ v: CHAIN_VERSION, tracking_code, event_type, from_status, to_status, reason, occurred_on, prev_hash });
}

/** The event's hash: lowercase hex SHA-256 of eventHashInput. */
export function hashEvent(event: ChainFields): string {
  return sha256Hex(eventHashInput(event));
}

/** Builds the next event on a chain whose head hash is `prevHash` (null for a ballot's first event). */
export function chainEvent(fields: Omit<ChainFields, "prev_hash">, prevHash: string | null): ChainedEvent {
  const event: ChainFields = { ...fields, prev_hash: prevHash };
  return { ...event, hash: hashEvent(event) };
}

export type ChainCheck = { ok: true } | { ok: false; index: number };

/**
 * Checks one ballot's events, in chain order: the first has prev_hash null, each later one points
 * at its predecessor, all share one tracking code, and each hash recomputes. On failure, `index` is
 * the first event that does not verify. Never throws.
 */
export function verifyChain(events: readonly ChainedEvent[]): ChainCheck {
  if (!Array.isArray(events)) return { ok: false, index: 0 };
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    try {
      if (!event || event.tracking_code !== events[0]?.tracking_code) return { ok: false, index };
      const expectedPrev = index === 0 ? null : (events[index - 1]?.hash ?? "");
      if (event.prev_hash !== expectedPrev) return { ok: false, index };
      if (event.hash !== hashEvent(event)) return { ok: false, index };
    } catch {
      return { ok: false, index };
    }
  }
  return { ok: true };
}

/**
 * The chain head (C9): the event whose hash is no other event's prev_hash. Never chosen by time.
 * Undefined when there are no events or the events do not have exactly one head.
 */
export function chainHead<T extends { hash: string; prev_hash: string | null }>(events: readonly T[]): T | undefined {
  const pointedAt = new Set(events.map((e) => e.prev_hash));
  const heads = events.filter((e) => !pointedAt.has(e.hash));
  return heads.length === 1 ? heads[0] : undefined;
}

/**
 * Puts one ballot's events in chain order by following prev_hash from the event with none. Returns
 * undefined unless the events form exactly one unbroken chain.
 */
export function orderChain<T extends { hash: string; prev_hash: string | null }>(events: readonly T[]): T[] | undefined {
  const byPrev = new Map<string | null, T>();
  for (const event of events) {
    if (byPrev.has(event.prev_hash)) return undefined;
    byPrev.set(event.prev_hash, event);
  }
  const ordered: T[] = [];
  for (let next = byPrev.get(null); next; next = byPrev.get(next.hash)) {
    ordered.push(next);
    if (ordered.length > events.length) return undefined;
  }
  return ordered.length === events.length ? ordered : undefined;
}
