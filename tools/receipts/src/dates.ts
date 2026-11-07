// Dates on paper are calendar dates only. A value with a time of day is rejected, never truncated,
// so a timestamp can't slip through to a receipt (Principle 5: no ordering leaks).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

/** Parses a strict `YYYY-MM-DD` date. Throws on anything else, including a date with a time. */
export function parseCalendarDate(value: string, field = "date"): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`${field} must be a date as YYYY-MM-DD with no time: ${JSON.stringify(value)}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new Error(`${field} is not a real calendar date: ${value}`);
  }
  return { year, month, day };
}

/** `2026-11-03` -> `Nov 3, 2026`. */
export function formatCalendarDate(value: string, field?: string): string {
  const { year, month, day } = parseCalendarDate(value, field);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}
