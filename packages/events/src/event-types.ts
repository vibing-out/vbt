// ballot_events.event_type values. Source: docs/locked-interfaces.md § Event schema (and the
// ballot_events_event_type_check constraint in supabase/migrations/20261107170000_core_schema.sql).
// The list itself lives in chain.ts (the hash chain validates against it); this adds the type guard.
import { EVENT_TYPES, type EventType } from "./chain.ts";

export { EVENT_TYPES, type EventType };

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value);
}
