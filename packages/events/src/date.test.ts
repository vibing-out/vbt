import { expect, test } from "vitest";
import { castOccurredAt, indianaDate, isIsoDate } from "./date.ts";

test("indianaDate is the calendar date in Indianapolis, not UTC", () => {
  // 03:30 UTC on Nov 4 is 22:30 on Nov 3 in Indiana (EST, UTC-5).
  expect(indianaDate("2026-11-04T03:30:00Z")).toBe("2026-11-03");
  expect(indianaDate(new Date("2026-11-04T05:30:00Z"))).toBe("2026-11-04");
  // Summer (EDT, UTC-4).
  expect(indianaDate("2026-07-01T03:30:00Z")).toBe("2026-06-30");
  expect(() => indianaDate("nope")).toThrow(RangeError);
});

test("C6: a CAST event occurs at noon Indiana standard time on the cast date, and keeps that date", () => {
  expect(castOccurredAt("2026-11-03")).toBe("2026-11-03T12:00:00-05:00");
  for (const day of ["2026-01-01", "2026-03-08", "2026-07-04", "2026-11-01", "2026-12-31"]) {
    expect(indianaDate(castOccurredAt(day))).toBe(day);
  }
  expect(() => castOccurredAt("2026-13-01")).toThrow(RangeError);
});

test("isIsoDate accepts only real YYYY-MM-DD dates", () => {
  expect(isIsoDate("2028-02-29")).toBe(true);
  for (const value of ["2026-02-29", "2026-1-01", "20261101", "2026-11-03T00:00", 20261103, null]) {
    expect(isIsoDate(value)).toBe(false);
  }
});
