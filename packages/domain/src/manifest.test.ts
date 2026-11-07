import { describe, expect, test } from "vitest";
import { type BallotChoices, checkChoices, type Manifest, summarizeChoices } from "./index.ts";

const MANIFEST: Manifest = {
  contests: [
    {
      id: "us-senate",
      title: "United States Senator",
      vote_for: 1,
      selections: [
        { id: "sen-oakley", name: "Dana Oakley" },
        { id: "sen-brandt", name: "Morgan Brandt" },
      ],
    },
    {
      id: "school-board",
      title: "School Board, At Large",
      vote_for: 2,
      selections: [
        { id: "sb-castellan", name: "Rosa Castellan" },
        { id: "sb-whitcomb", name: "Eli Whitcomb" },
        { id: "sb-nakamura", name: "Kenji Nakamura" },
      ],
    },
    {
      id: "mayor",
      title: "Mayor",
      vote_for: 1,
      selections: [{ id: "m-ruiz", name: "Ana Ruiz" }],
    },
  ],
  ballot_styles: [
    { id: "county", contest_ids: ["school-board", "us-senate"] },
    { id: "city", contest_ids: ["us-senate", "school-board", "mayor"] },
    { id: "broken", contest_ids: ["us-senate", "governor"] },
  ],
};

const VALID: BallotChoices = { "us-senate": ["sen-oakley"], "school-board": ["sb-nakamura", "sb-castellan"] };

describe("checkChoices", () => {
  test("accepts valid choices, a full vote, an undervote and no choices at all", () => {
    expect(checkChoices(MANIFEST, "county", VALID)).toBeNull();
    expect(checkChoices(MANIFEST, "county", { "school-board": ["sb-whitcomb"] })).toBeNull();
    expect(checkChoices(MANIFEST, "county", { "us-senate": [] })).toBeNull();
    expect(checkChoices(MANIFEST, "county", {})).toBeNull();
  });

  test("rejects an unknown ballot style", () => {
    expect(checkChoices(MANIFEST, "primary", {})).toEqual({
      code: "UNKNOWN_BALLOT_STYLE",
      message: "Unknown ballot style primary",
    });
  });

  test("rejects a ballot style that lists a contest the manifest lacks", () => {
    expect(checkChoices(MANIFEST, "broken", {})).toMatchObject({ code: "UNKNOWN_CONTEST", contestId: "governor" });
  });

  test("rejects a ballot style that lists a contest more than once", () => {
    const manifest: Manifest = {
      contests: MANIFEST.contests,
      ballot_styles: [{ id: "repeat", contest_ids: ["us-senate", "school-board", "us-senate"] }],
    };
    expect(checkChoices(manifest, "repeat", {})).toEqual({
      code: "DUPLICATE_CONTEST",
      contestId: "us-senate",
      message: "Ballot style repeat lists contest us-senate more than once",
    });
    // Valid choices don't hide it, and summarizeChoices refuses the style too.
    expect(checkChoices(manifest, "repeat", { "us-senate": ["sen-oakley"] })).toMatchObject({ code: "DUPLICATE_CONTEST" });
    expect(summarizeChoices(manifest, "repeat", {})).toMatchObject({ ok: false, code: "DUPLICATE_CONTEST" });
  });

  test("reports an unknown contest on a style before a repeated one", () => {
    const manifest: Manifest = {
      contests: MANIFEST.contests,
      ballot_styles: [{ id: "both", contest_ids: ["governor", "mayor", "mayor"] }],
    };
    expect(checkChoices(manifest, "both", {})).toMatchObject({ code: "UNKNOWN_CONTEST", contestId: "governor" });
  });

  test("rejects a contest that is not on the style, whether or not the manifest knows it", () => {
    expect(checkChoices(MANIFEST, "county", { mayor: ["m-ruiz"] })).toEqual({
      code: "CONTEST_NOT_ON_STYLE",
      contestId: "mayor",
      message: "Contest mayor is not on ballot style county",
    });
    expect(checkChoices(MANIFEST, "county", { dogcatcher: [] })).toMatchObject({
      code: "CONTEST_NOT_ON_STYLE",
      contestId: "dogcatcher",
    });
    expect(checkChoices(MANIFEST, "city", { mayor: ["m-ruiz"] })).toBeNull();
  });

  test("rejects the same selection twice, even within vote_for", () => {
    expect(checkChoices(MANIFEST, "county", { "school-board": ["sb-whitcomb", "sb-whitcomb"] })).toMatchObject({
      code: "DUPLICATE_SELECTION",
      contestId: "school-board",
      selectionId: "sb-whitcomb",
    });
  });

  test("rejects more selections than vote_for", () => {
    expect(checkChoices(MANIFEST, "county", { "us-senate": ["sen-oakley", "sen-brandt"] })).toEqual({
      code: "OVERVOTE",
      contestId: "us-senate",
      message: "Contest us-senate selects more than 1",
    });
    expect(
      checkChoices(MANIFEST, "county", { "school-board": ["sb-castellan", "sb-whitcomb", "sb-nakamura"] }),
    ).toMatchObject({ code: "OVERVOTE", contestId: "school-board" });
  });

  test("rejects a selection from another contest or none at all", () => {
    expect(checkChoices(MANIFEST, "county", { "us-senate": ["sb-castellan"] })).toEqual({
      code: "UNKNOWN_SELECTION",
      contestId: "us-senate",
      selectionId: "sb-castellan",
      message: "Unknown selection sb-castellan in contest us-senate",
    });
  });

  test("reports the first problem in choice order", () => {
    const choices = { "us-senate": ["nobody"], mayor: ["m-ruiz"] };
    expect(checkChoices(MANIFEST, "county", choices)?.code).toBe("UNKNOWN_SELECTION");
  });
});

describe("summarizeChoices", () => {
  test("lists every contest on the style in style order, with undervotes empty", () => {
    expect(summarizeChoices(MANIFEST, "city", { "school-board": ["sb-nakamura", "sb-castellan"] })).toEqual({
      ok: true,
      contests: [
        { contestId: "us-senate", title: "United States Senator", voteFor: 1, selected: [] },
        {
          contestId: "school-board",
          title: "School Board, At Large",
          voteFor: 2,
          selected: ["Kenji Nakamura", "Rosa Castellan"],
        },
        { contestId: "mayor", title: "Mayor", voteFor: 1, selected: [] },
      ],
    });
  });

  test("refuses invalid choices with the same problem checkChoices reports", () => {
    const bad = { "us-senate": ["sen-oakley", "sen-brandt"] };
    expect(summarizeChoices(MANIFEST, "county", bad)).toEqual({ ok: false, ...checkChoices(MANIFEST, "county", bad) });
    expect(summarizeChoices(MANIFEST, "nope", {})).toMatchObject({ ok: false, code: "UNKNOWN_BALLOT_STYLE" });
  });
});
