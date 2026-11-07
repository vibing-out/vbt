// Shared PDF plumbing. Documents carry no dates: pdf-lib stamps CreationDate and ModDate with the
// current time unless metadata updating is off, and a receipt's file must not reveal when it was made.

import { PDFDocument, type PDFFont } from "pdf-lib";

/** 72 points per inch. */
export const INCH = 72;

/** A new document with metadata updating off: no CreationDate, ModDate, Creator or Producer dates. */
export async function newDocument(title: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(title);
  doc.setProducer("VBT tools/receipts");
  return doc;
}

/** Saves without object streams, so the document info dictionary stays plain text and inspectable. */
export function saveDocument(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

/**
 * The width `text` takes when drawn. pdf-lib's widthOfTextAtSize applies kerning pairs, but drawText
 * prints without kerning, so the drawn line is wider than that measure; summing single characters
 * (which have no pairs) gives the drawn width.
 */
export function drawnWidth(text: string, font: PDFFont, size: number): number {
  let width = 0;
  for (const ch of text) width += font.widthOfTextAtSize(ch, size);
  return width;
}

/** Greedy word wrap to a maximum width. A single word wider than the line is kept whole. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && drawnWidth(candidate, font, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The largest size, at most `max`, at which `text` fits in `maxWidth`. */
export function fitSize(text: string, font: PDFFont, max: number, maxWidth: number): number {
  const width = drawnWidth(text, font, max);
  return width <= maxWidth ? max : Math.floor((max * maxWidth) / width * 10) / 10;
}

export interface FittedLine {
  text: string;
  size: number;
}

/**
 * Lays `text` out inside `maxWidth`: unchanged on one line when it fits at `size`; otherwise word-wrapped,
 * with any line that still overflows (one long word, such as a web address) shrunk to fit.
 */
export function fitText(text: string, font: PDFFont, size: number, maxWidth: number): FittedLine[] {
  if (drawnWidth(text, font, size) <= maxWidth) return [{ text, size }];
  return wrapText(text, font, size, maxWidth).map((line) => ({ text: line, size: fitSize(line, font, size, maxWidth) }));
}
