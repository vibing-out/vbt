// Dates in Indiana election-office time, the same zone the database uses for
// ballot_events.occurred_on (supabase/migrations/20261107190000_public_surface_fixes.sql). Public
// records carry the date only, never the time or sequence (locked principle 5).

export const INDIANA_TIME_ZONE = "America/Indiana/Indianapolis";

const FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: INDIANA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The calendar date (YYYY-MM-DD) of an instant in Indiana. */
export function indianaDate(instant: Date | string): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) throw new RangeError("invalid instant");
  return FORMAT.format(date);
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * occurred_at stored for a CAST event (T-05 C6): noon Indiana standard time on the cast date. Only
 * the date of casting is known or kept; noon keeps the Indiana date equal to the cast date whatever
 * the daylight-saving offset.
 */
export function castOccurredAt(castDate: string): string {
  if (!isIsoDate(castDate)) throw new RangeError("castDate must be YYYY-MM-DD");
  return `${castDate}T12:00:00-05:00`;
}
