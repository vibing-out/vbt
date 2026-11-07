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

/** Greedy word wrap to a maximum width. A single word wider than the line is kept whole. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
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
  const width = font.widthOfTextAtSize(text, max);
  return width <= maxWidth ? max : Math.floor((max * maxWidth) / width * 10) / 10;
}
