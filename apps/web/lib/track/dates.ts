// Dates for the public tracker. The tracker shows dates only, never a time of day or a sequence
// (locked principle 5; locked-interfaces § Cross-checks privacy rule).

// The demo jurisdiction's election-office time zone; the same literal the database uses for
// ballot_events.occurred_on (supabase/migrations/20261107190000_public_surface_fixes.sql §2).
export const ELECTION_TIME_ZONE = "America/Indiana/Indianapolis";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const indianaDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: ELECTION_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const displayDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "long",
  day: "numeric",
});

/** True for a plain "YYYY-MM-DD" date with nothing after it. */
export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value);
}

/** A timestamptz cut to its "YYYY-MM-DD" date in election-office time, or null if it isn't a valid instant. */
export function toIndianaDate(timestamp: unknown): string | null {
  if (typeof timestamp !== "string") return null;
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = Object.fromEntries(indianaDate.formatToParts(instant).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return isIsoDate(date) ? date : null;
}

/** "2026-11-03" → "November 3, 2026". Formatted in UTC so the calendar date never shifts. */
export function formatDisplayDate(isoDate: string | null): string | null {
  if (!isIsoDate(isoDate)) return null;
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return displayDate.format(new Date(Date.UTC(year, month - 1, day)));
}
