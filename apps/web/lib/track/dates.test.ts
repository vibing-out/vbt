import { expect, test } from "vitest";
import { formatDisplayDate, isIsoDate, toIndianaDate } from "./dates";

test("an instant at 03:30 UTC on Nov 4 is Nov 3 in Indiana", () => {
  expect(toIndianaDate("2026-11-04T03:30:00Z")).toBe("2026-11-03");
  expect(toIndianaDate("2026-11-04T03:30:00+00:00")).toBe("2026-11-03");
});

test("an instant after Indiana midnight is the next day", () => {
  expect(toIndianaDate("2026-11-04T05:30:00Z")).toBe("2026-11-04");
});

test("the output is a date only, never a time", () => {
  for (const ts of ["2026-11-03T12:34:56Z", "2026-11-18T16:00:00.123Z", "2026-07-01T23:59:59-04:00"]) {
    const date = toIndianaDate(ts);
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(date).not.toMatch(/\d{1,2}:\d{2}/);
  }
});

test("invalid input gives null", () => {
  expect(toIndianaDate("not a date")).toBeNull();
  expect(toIndianaDate(null)).toBeNull();
  expect(toIndianaDate(12)).toBeNull();
});

test("isIsoDate accepts only a bare date", () => {
  expect(isIsoDate("2026-11-03")).toBe(true);
  expect(isIsoDate("2026-11-03T12:00:00Z")).toBe(false);
  expect(isIsoDate("2026-11-03 12:00")).toBe(false);
});

test("display dates read plainly and never shift a day", () => {
  expect(formatDisplayDate("2026-11-03")).toBe("November 3, 2026");
  expect(formatDisplayDate("2026-01-01")).toBe("January 1, 2026");
  expect(formatDisplayDate(null)).toBeNull();
  expect(formatDisplayDate("2026-11-03T10:00:00Z")).toBeNull();
});
