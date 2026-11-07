// Voter and admin modes (design system README, Layout and modes).

export type Mode = "voter" | "admin";

export const DEFAULT_MODE: Mode = "voter";

/** Lucide icon size: 20px in voter mode, 16px in admin mode. */
export function iconSize(mode: Mode): 16 | 20 {
  return mode === "admin" ? 16 : 20;
}

/** Text style for sentences: voter sentences never go below body-lg (18px). */
export function bodyText(mode: Mode): "text-body-lg" | "text-body" {
  return mode === "admin" ? "text-body" : "text-body-lg";
}

/** Text style for dense content: dates, hints and table cells. */
export function smallText(mode: Mode): "text-body-lg" | "text-small" {
  return mode === "admin" ? "text-small" : "text-body-lg";
}

/**
 * Principle 5 (no ordering leaks): public views show dates, never a time of day.
 * Matches "9:42", "21:05" and the like.
 */
export const TIME_OF_DAY = /\d{1,2}:\d{2}/;

/**
 * Returns the date if it holds no time of day. A time is a bug in the caller: it throws outside
 * production so tests catch it, and in production drops the value rather than leak it.
 */
export function dateOnly(value: string | undefined, what: string): string | undefined {
  if (value === undefined || !TIME_OF_DAY.test(value)) return value;
  if (process.env.NODE_ENV !== "production") {
    throw new Error(`${what} must be a date with no time of day (got "${value}")`);
  }
  return undefined;
}
