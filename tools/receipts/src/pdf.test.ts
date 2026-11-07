import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { drawnWidth, fitSize, fitText, wrapText } from "./pdf.ts";

const doc = await PDFDocument.create();
const helvetica = await doc.embedFont(StandardFonts.Helvetica);

describe("drawnWidth", () => {
  it("measures without kerning, as drawText prints, so it is never narrower than the kerned measure", () => {
    const text = "AVAVAV Track it: www.ballottrack.org/track";
    expect(drawnWidth(text, helvetica, 10)).toBeGreaterThan(helvetica.widthOfTextAtSize(text, 10));
    expect(drawnWidth("", helvetica, 10)).toBe(0);
  });
});

describe("fitText", () => {
  it("keeps a line that fits exactly as given, spacing included", () => {
    expect(fitText("Or call:   (317) 555-0100", helvetica, 10, 200)).toEqual([
      { text: "Or call:   (317) 555-0100", size: 10 },
    ]);
  });

  it("wraps a long line at word boundaries, every word kept, each line within the width", () => {
    const text = "Precinct Washington Township Northeast Consolidated Fire District Annex 14 (18097-001)";
    const lines = fitText(text, helvetica, 10, 120);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((l) => l.text).join(" ")).toBe(text);
    for (const l of lines) expect(drawnWidth(l.text, helvetica, l.size)).toBeLessThanOrEqual(120);
  });

  it("shrinks a single word too long for any line", () => {
    const lines = fitText("Track it: a-very-long-preview-host.example.vercel.app/track", helvetica, 10, 120);
    expect(lines[0]).toEqual({ text: "Track it:", size: 10 });
    expect(lines[1]!.size).toBeLessThan(10);
    expect(drawnWidth(lines[1]!.text, helvetica, lines[1]!.size)).toBeLessThanOrEqual(120);
  });
});

describe("wrapText and fitSize", () => {
  it("wrap by drawn width and fit by drawn width", () => {
    for (const line of wrapText("AVAVAVAV AVAVAVAV AVAVAVAV", helvetica, 10, 100)) {
      expect(drawnWidth(line, helvetica, 10)).toBeLessThanOrEqual(100);
    }
    const size = fitSize("AVAVAVAVAVAVAVAVAVAV", helvetica, 16, 100);
    expect(drawnWidth("AVAVAVAVAVAVAVAVAVAV", helvetica, size)).toBeLessThanOrEqual(100);
  });
});
