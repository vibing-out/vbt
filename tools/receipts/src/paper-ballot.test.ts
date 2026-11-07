import { describe, expect, it } from "vitest";
import { DEFAULT_TRACKER_BASE_URL } from "./config.ts";
import { exampleInput } from "./fixtures.ts";
import { generateBallotDocuments } from "./generate.ts";
import { buildPaperBallotPdf, NO_SELECTION, summarizeChoices, type PaperBallotInput } from "./paper-ballot.ts";
import { extractPdf, PDF_DATE_WITH_TIME, TIME_OF_DAY } from "./test-support.ts";

const input = exampleInput();

function paperInput(index: number): PaperBallotInput {
  const b = input.ballots[index]!;
  return {
    machineId: b.machine_id,
    precinctId: b.precinct_id,
    precinctName: input.precincts.find((p) => p.id === b.precinct_id)!.name,
    ballotStyle: b.ballot_style,
    castDate: b.cast_date,
    countyName: input.election.county_name,
    electionName: input.election.name,
    manifest: input.manifest,
    choices: b.choices,
  };
}

describe("paper ballot record (VVPAT content)", () => {
  it("shows machine ID, precinct, ballot style, date and every choice", async () => {
    const { text } = await extractPdf(await buildPaperBallotPdf(paperInput(0)));
    expect(text).toContain("OFFICIAL BALLOT RECORD");
    expect(text).toContain("Machine ID: M-18097-001-A");
    expect(text).toContain("Precinct: Center 1 (18097-001)");
    expect(text).toContain("Ballot style: general-2026");
    expect(text).toContain("Date: Nov 3, 2026");
    for (const s of ["United States Senator", "Dana Oakley", "Secretary of State", "Theo Harlow"]) {
      expect(text).toContain(s);
    }
    for (const s of ["School Board, At Large", "Rosa Castellan", "Kenji Nakamura", "Public Question 1: Library Bond", "Yes"]) {
      expect(text).toContain(s);
    }
    expect(text).not.toContain("Morgan Brandt"); // not chosen
  });

  it("lists every contest on the style, marking undervotes", async () => {
    const summary = summarizeChoices(paperInput(1));
    expect(summary.map((c) => c.title)).toEqual([
      "United States Senator",
      "Secretary of State",
      "School Board, At Large",
      "Public Question 1: Library Bond",
    ]);
    expect(summary[1]!.selected).toEqual([]);
    const { text } = await extractPdf(await buildPaperBallotPdf(paperInput(1)));
    expect(text.split(NO_SELECTION)).toHaveLength(3); // two undervoted contests
  });

  it("rejects choices that don't match the manifest", () => {
    expect(() => summarizeChoices({ ...paperInput(0), ballotStyle: "nope" })).toThrow(/ballot style/);
    expect(() => summarizeChoices({ ...paperInput(0), choices: { mayor: ["x"] } })).toThrow(/not on ballot style/);
    expect(() => summarizeChoices({ ...paperInput(0), choices: { "us-senate": ["x"] } })).toThrow(/Unknown selection/);
  });

  it("grows the page to fit a long ballot", async () => {
    const contests = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`,
      title: `Contest number ${i} with a fairly long title that has to wrap onto a second line`,
      vote_for: 1,
      selections: [{ id: "a", name: "Candidate A" }],
    }));
    const manifest = { contests, ballot_styles: [{ id: "long", contest_ids: contests.map((c) => c.id) }] };
    const pdf = await buildPaperBallotPdf({ ...paperInput(0), manifest, ballotStyle: "long", choices: {} });
    const { lines, pageHeight } = await extractPdf(pdf);
    expect(pageHeight).toBeGreaterThan(12 * 72);
    expect(Math.min(...lines.map((l) => l.y))).toBeGreaterThan(0);
  });
});

describe("AC (required test 3): the paper ballot record carries no tracking code", () => {
  it("has no tracking code in its text, metadata or bytes, for every ballot", async () => {
    const docs = await generateBallotDocuments(input, { baseUrl: DEFAULT_TRACKER_BASE_URL });
    const codes = input.ballots.map((b) => b.tracking_code);
    for (const doc of docs) {
      const { text, info, images } = await extractPdf(doc.paperBallot);
      expect(text).toContain("OFFICIAL BALLOT RECORD"); // the extraction works
      expect(images).toHaveLength(0); // no QR code either
      const raw = Buffer.from(doc.paperBallot).toString("latin1");
      for (const code of codes) {
        expect(text).not.toContain(code);
        expect(JSON.stringify(info)).not.toContain(code);
        expect(raw).not.toContain(code);
      }
      expect(text).not.toContain("SEED-");
      expect(text).not.toContain("track");
    }
  });

  it("has no time of day and no dated metadata", async () => {
    const pdf = await buildPaperBallotPdf(paperInput(2));
    const { text, info } = await extractPdf(pdf);
    expect(text).not.toMatch(TIME_OF_DAY);
    expect(info.CreationDate).toBeUndefined();
    expect(info.ModDate).toBeUndefined();
    expect(Buffer.from(pdf).toString("latin1")).not.toMatch(PDF_DATE_WITH_TIME);
  });
});
