// The paper ballot record that goes in the ballot box, modeled on California's VVPAT content: machine ID,
// precinct, ballot style, date and a full summary of choices (every contest on the style, including
// undervotes). Paper is authoritative (Principle 3), so the record says so.
//
// It never carries the tracking code: the box holds choices, the voter's pocket holds the code, and
// nothing printed joins the two.

import { rgb, StandardFonts } from "pdf-lib";
import { formatCalendarDate } from "./dates.ts";
import type { BallotStyle, Contest, Manifest } from "./input.ts";
import { INCH, newDocument, saveDocument, wrapText } from "./pdf.ts";

export interface PaperBallotInput {
  machineId: string;
  precinctId: string;
  precinctName: string;
  ballotStyle: string;
  /** YYYY-MM-DD; the date only. */
  castDate: string;
  countyName: string;
  electionName: string;
  manifest: Manifest;
  /** contest id -> selection ids. */
  choices: Record<string, string[]>;
}

export interface ContestSummary {
  title: string;
  voteFor: number;
  /** Selection names, or empty for an undervote. */
  selected: string[];
}

export const NO_SELECTION = "No selection";

/** Every contest on the ballot style, in manifest order, with what was selected. */
export function summarizeChoices(input: Pick<PaperBallotInput, "manifest" | "ballotStyle" | "choices">): ContestSummary[] {
  const style: BallotStyle | undefined = input.manifest.ballot_styles.find((s) => s.id === input.ballotStyle);
  if (!style) throw new Error(`Unknown ballot style ${input.ballotStyle}`);
  for (const contestId of Object.keys(input.choices)) {
    if (!style.contest_ids.includes(contestId)) throw new Error(`Contest ${contestId} is not on ballot style ${style.id}`);
  }
  return style.contest_ids.map((contestId) => {
    const contest: Contest | undefined = input.manifest.contests.find((c) => c.id === contestId);
    if (!contest) throw new Error(`Unknown contest ${contestId}`);
    const selected = (input.choices[contestId] ?? []).map((id) => {
      const selection = contest.selections.find((s) => s.id === id);
      if (!selection) throw new Error(`Unknown selection ${id} in contest ${contestId}`);
      return selection.name;
    });
    return { title: contest.title, voteFor: contest.vote_for, selected };
  });
}

const WIDTH = 4 * INCH;
const MARGIN = 0.3 * INCH;

interface Line {
  text: string;
  bold?: boolean;
  size?: number;
  indent?: number;
  gapAfter?: number;
  rule?: boolean;
}

/** Builds the paper ballot record PDF for one ballot. The page grows with the number of contests. */
export async function buildPaperBallotPdf(input: PaperBallotInput): Promise<Uint8Array> {
  const contests = summarizeChoices(input);
  const doc = await newDocument("Paper ballot record");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const textWidth = WIDTH - 2 * MARGIN;

  const lines: Line[] = [
    { text: "OFFICIAL BALLOT RECORD", bold: true, size: 12, gapAfter: 4 },
    { text: `${input.countyName} ${input.electionName}`, bold: true, size: 10, gapAfter: 8 },
    { text: `Machine ID: ${input.machineId}` },
    { text: `Precinct: ${input.precinctName} (${input.precinctId})` },
    { text: `Ballot style: ${input.ballotStyle}` },
    { text: `Date: ${formatCalendarDate(input.castDate, "castDate")}`, gapAfter: 8 },
    { text: "", rule: true, gapAfter: 8 },
  ];
  for (const contest of contests) {
    for (const t of wrapText(contest.title, bold, 10, textWidth)) lines.push({ text: t, bold: true });
    lines.push({ text: `Vote for ${contest.voteFor}`, size: 8 });
    const picks = contest.selected.length > 0 ? contest.selected : [NO_SELECTION];
    picks.forEach((name, i) => {
      const wrapped = wrapText(name, regular, 10, textWidth - 12);
      wrapped.forEach((t, j) => {
        const last = i === picks.length - 1 && j === wrapped.length - 1;
        lines.push({ text: t, indent: 12, gapAfter: last ? 8 : 3 });
      });
    });
  }
  lines.push(
    { text: "", rule: true, gapAfter: 8 },
    { text: "Ballot cast. This paper record is the official ballot", size: 8 },
    { text: "and decides any recount.", size: 8 },
  );

  const lineHeight = (l: Line) => (l.rule ? 1 : (l.size ?? 10)) + (l.gapAfter ?? 3);
  const height = Math.max(4 * INCH, 2 * MARGIN + lines.reduce((sum, l) => sum + lineHeight(l), 0));
  const page = doc.addPage([WIDTH, height]);
  const ink = rgb(0, 0, 0);

  let y = height - MARGIN;
  for (const l of lines) {
    if (l.rule) {
      y -= 1;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 0.75, color: ink });
    } else {
      const size = l.size ?? 10;
      y -= size;
      page.drawText(l.text, { x: MARGIN + (l.indent ?? 0), y, size, font: l.bold ? bold : regular, color: ink });
    }
    y -= l.gapAfter ?? 3;
  }

  return saveDocument(doc);
}
