// Test-only helpers. They read generated PDFs with tools other than the one that wrote them: pdf.js
// extracts text, metadata and drawing positions, and jsQR decodes the QR code from the image's pixels.

import { inflateSync } from "node:zlib";
import jsQR from "jsqr";
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface TextLine {
  text: string;
  /** Baseline height from the bottom of the page, in points. */
  y: number;
}

export interface ImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractedPdf {
  lines: TextLine[];
  text: string;
  info: Record<string, unknown>;
  images: ImagePlacement[];
  pageHeight: number;
}

type Matrix = [number, number, number, number, number, number];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

/** Extracts the first page's text lines, image placements and the document info dictionary. */
export async function extractPdf(bytes: Uint8Array): Promise<ExtractedPdf> {
  const task = getDocument({
    data: new Uint8Array(bytes), // pdf.js takes ownership of the buffer it's given
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    // pdf.js may split one drawn line into several items; join items on the same baseline and
    // collapse runs of whitespace so tests compare words, not spacing.
    const byBaseline = new Map<number, string[]>();
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = Math.round((item.transform[5] as number) * 100) / 100;
      byBaseline.set(y, [...(byBaseline.get(y) ?? []), item.str]);
    }
    const lines: TextLine[] = [...byBaseline.entries()]
      .map(([y, parts]) => ({ y, text: parts.join(" ").replace(/\s+/g, " ").trim() }))
      .filter((l) => l.text !== "")
      .sort((a, b) => b.y - a.y);

    const ops = await page.getOperatorList();
    const images: ImagePlacement[] = [];
    const stack: Matrix[] = [];
    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    ops.fnArray.forEach((fn, i) => {
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = multiply(ops.argsArray[i] as Matrix, ctm);
      else if (fn === OPS.paintImageXObject) {
        images.push({ x: ctm[4], y: ctm[5], width: ctm[0], height: ctm[3] });
      }
    });

    const { info } = await doc.getMetadata();
    return {
      lines,
      text: lines.map((l) => l.text).join("\n"),
      info: info as Record<string, unknown>,
      images,
      pageHeight: page.view[3] as number,
    };
  } finally {
    await task.destroy();
  }
}

/** Finds each image on the first page and decodes it as a QR code from its raw pixels. */
export async function decodeQrCodes(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const resources = doc.getPage(0).node.Resources();
  const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  const decoded: string[] = [];
  for (const [, ref] of xobjects?.entries() ?? []) {
    const stream = doc.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    const dict = stream.dict;
    if (dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const width = dict.lookup(PDFName.of("Width"), PDFNumber).asNumber();
    const height = dict.lookup(PDFName.of("Height"), PDFNumber).asNumber();
    const bits = dict.lookup(PDFName.of("BitsPerComponent"), PDFNumber).asNumber();
    if (dict.get(PDFName.of("ColorSpace")) !== PDFName.of("DeviceRGB") || bits !== 8) {
      throw new Error("expected an 8-bit RGB image");
    }
    const filter = dict.get(PDFName.of("Filter"));
    const rgbData = filter === PDFName.of("FlateDecode") ? inflateSync(stream.contents) : Buffer.from(stream.contents);
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let p = 0; p < width * height; p++) {
      rgba[p * 4] = rgbData[p * 3] as number;
      rgba[p * 4 + 1] = rgbData[p * 3 + 1] as number;
      rgba[p * 4 + 2] = rgbData[p * 3 + 2] as number;
      rgba[p * 4 + 3] = 255;
    }
    const result = jsQR(rgba, width, height);
    if (result) decoded.push(result.data);
  }
  return decoded;
}

/** Matches a clock time such as 7:05, 07:05, 19:05:33. */
export const TIME_OF_DAY = /\b\d{1,2}:\d{2}\b/;

/** Matches a PDF date string carrying a time of day (D:YYYYMMDDHH...). */
export const PDF_DATE_WITH_TIME = /D:\d{10}/;

/** Matches `s` as a whole word or phrase, so "No" does not match inside "NOV". */
export function wholeWord(s: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`);
}
