import { describe, expect, it } from "vitest";
import { exampleRaw } from "./fixtures.ts";
import { parseInput } from "./input.ts";
import { formatCalendarDate, parseCalendarDate } from "./dates.ts";

// The tests mutate parsed JSON freely.
type Raw = Record<string, any>;

function withBallot(change: (b: Raw) => void): Raw {
  const raw = exampleRaw() as Raw;
  change(raw.ballots[0]);
  return raw;
}

describe("parseInput", () => {
  it("accepts the shipped example", () => {
    const input = parseInput(exampleRaw());
    expect(input.ballots.map((b) => b.tracking_code)).toEqual(["SEED-0001", "SEED-0002", "SEED-0018", "SEED-0035"]);
  });

  it("rejects a cast date with a time", () => {
    expect(() => parseInput(withBallot((b) => (b.cast_date = "2026-11-03T07:42:00Z")))).toThrow(/no time/);
  });

  it("rejects unknown fields, so a time or a voter's details can't ride along", () => {
    expect(() => parseInput(withBallot((b) => (b.cast_at = "07:42")))).toThrow(/unknown field\(s\): cast_at/);
    expect(() => parseInput(withBallot((b) => (b.voter_name = "x")))).toThrow(/unknown field/);
    const raw = exampleRaw() as Raw;
    raw.extra = 1;
    expect(() => parseInput(raw)).toThrow(/unknown field/);
  });

  it("rejects missing fields and bad shapes", () => {
    expect(() => parseInput(withBallot((b) => delete b.machine_id))).toThrow(/machine_id is required/);
    expect(() => parseInput(withBallot((b) => (b.choices = [])))).toThrow(/choices must be an object/);
    expect(() => parseInput({ ...exampleRaw(), version: 2 })).toThrow(/version/);
    expect(() => parseInput(null)).toThrow(/must be an object/);
  });

  it("rejects references the manifest doesn't know", () => {
    expect(() => parseInput(withBallot((b) => (b.precinct_id = "99999-999")))).toThrow(/not in precincts/);
    expect(() => parseInput(withBallot((b) => (b.ballot_style = "primary")))).toThrow(/not in manifest/);
    expect(() => parseInput(withBallot((b) => (b.choices = { mayor: ["x"] })))).toThrow(/not on ballot style/);
    expect(() => parseInput(withBallot((b) => (b.choices = { "us-senate": ["nobody"] })))).toThrow(/unknown selection/);
  });

  it("rejects overvotes and repeated selections", () => {
    expect(() => parseInput(withBallot((b) => (b.choices = { "us-senate": ["sen-oakley", "sen-brandt"] })))).toThrow(
      /more than 1/,
    );
    expect(() => parseInput(withBallot((b) => (b.choices = { "school-board": ["sb-whitcomb", "sb-whitcomb"] })))).toThrow(
      /same choice twice/,
    );
  });

  it("rejects duplicate and unprintable tracking codes", () => {
    const raw = exampleRaw() as Raw;
    raw.ballots[1].tracking_code = raw.ballots[0].tracking_code;
    expect(() => parseInput(raw)).toThrow(/appears twice/);
    expect(() => parseInput(withBallot((b) => (b.tracking_code = "seed 1")))).toThrow(/letters, digits/);
    expect(() => parseInput(withBallot((b) => (b.tracking_code = "A".repeat(65))))).toThrow(/at most 64/);
  });

  it("rejects a ballot style that lists a contest twice, even if no ballot uses that style", () => {
    const raw = exampleRaw() as Raw;
    const style = raw.manifest.ballot_styles[0];
    style.contest_ids.push(style.contest_ids[0]);
    expect(() => parseInput(raw)).toThrow(new RegExp(`ballot_styles\\[0\\] lists a contest twice \\(${style.contest_ids[0]}\\)`));

    const unused = exampleRaw() as Raw;
    const first = unused.manifest.contests[0].id;
    unused.manifest.ballot_styles.push({ id: "unused-style", contest_ids: [first, first] });
    expect(() => parseInput(unused)).toThrow(/lists a contest twice/);
  });

  it("still reports an unknown contest on a ballot style", () => {
    const raw = exampleRaw() as Raw;
    raw.manifest.ballot_styles[0].contest_ids.push("governor");
    expect(() => parseInput(raw)).toThrow(/lists unknown contest governor/);
  });

  it("rejects duplicate ids in the manifest", () => {
    const raw = exampleRaw() as Raw;
    raw.manifest.contests.push(raw.manifest.contests[0]);
    expect(() => parseInput(raw)).toThrow(/duplicate id us-senate/);
  });
});

describe("calendar dates", () => {
  it("formats YYYY-MM-DD as a short date", () => {
    expect(formatCalendarDate("2026-11-03")).toBe("Nov 3, 2026");
    expect(formatCalendarDate("2024-02-29")).toBe("Feb 29, 2024");
  });

  it("rejects impossible dates and anything with a time", () => {
    expect(() => parseCalendarDate("2026-02-29")).toThrow(/real calendar date/);
    expect(() => parseCalendarDate("2026-13-01")).toThrow(/real calendar date/);
    expect(() => parseCalendarDate("2026-11-03T00:00")).toThrow(/no time/);
    expect(() => parseCalendarDate("Nov 3, 2026")).toThrow(/YYYY-MM-DD/);
  });
});
