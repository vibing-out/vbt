// ballot_events.event_type values. Source: docs/locked-interfaces.md § Event schema (and the
// ballot_events_event_type_check constraint in supabase/migrations/20261107170000_core_schema.sql).

export const EVENT_TYPES = Object.freeze(["CAST", "STATUS_CHANGE", "MISMATCH_DETECTED", "CHALLENGE_RESOLVED", "SPOILED"] as const);

export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value);
}
