// The voter's receipt: a separate, tinted slip that carries only what a voter needs to track the ballot.
// Layout follows the receipt mockup in docs/voter-journey.md: title line, precinct, readable tracking
// code, QR code, web address, phone line, and the "does not show how you voted" footer. The mockup's
// "Phone code" and "Text updates" lines belong to stretch tickets T-17 and T-18 and are left out.
//
// The input type has no field for choices, machine ID, time or name, so none can reach the slip.

import { rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";
import { PLACEHOLDER_PHONE, printedWebAddress, trackerUrl } from "./config.ts";
import { formatCalendarDate } from "./dates.ts";
import { assertTrackingCode } from "./input.ts";
import { fitSize, INCH, newDocument, saveDocument, wrapText } from "./pdf.ts";

export interface ReceiptInput {
  /** Printed exactly as stored; never derived or reformatted. */
  trackingCode: string;
  precinctId: string;
  precinctName: string;
  /** YYYY-MM-DD; the date only, never a time. */
  castDate: string;
  countyName: string;
  electionName: string;
  /** Election day, YYYY-MM-DD. */
  electionDate: string;
  /** Tracker base URL; the QR code opens `<base>/track/<code>`. */
  baseUrl: string;
  /** Defaults to the placeholder line. */
  phone?: string;
}

/** The receipt's printed lines, in order, without the QR code. Exposed so tests and previews agree. */
export function receiptLines(input: ReceiptInput): {
  title: string;
  precinct: string;
  castOn: string;
  codeLabel: string;
  code: string;
  trackIt: string;
  orCall: string;
  footer: [string, string];
} {
  const code = assertTrackingCode(input.trackingCode);
  const electionDay = formatCalendarDate(input.electionDate, "electionDate").toUpperCase();
  return {
    title: `${input.countyName} ${input.electionName}`.toUpperCase() + ` · ${electionDay}`,
    precinct: `Precinct ${input.precinctName} (${input.precinctId})`,
    castOn: `Cast on ${formatCalendarDate(input.castDate, "castDate")}`,
    codeLabel: "Your ballot tracking code:",
    code,
    trackIt: `Track it:  ${printedWebAddress(input.baseUrl)}`,
    orCall: `Or call:   ${input.phone ?? PLACEHOLDER_PHONE}`,
    footer: ["This code shows your ballot's progress.", "It does not show how you voted."],
  };
}

/** Receipt slip size: 4 x 6 inches. */
export const RECEIPT_WIDTH = 4 * INCH;
export const RECEIPT_HEIGHT = 6 * INCH;
/** Pale yellow, so the slip is easy to tell apart from the white paper ballot. */
export const RECEIPT_TINT = rgb(1, 0.96, 0.78);

const MARGIN = 0.3 * INCH;
const QR_SIZE = 2 * INCH;

/** Builds the receipt PDF for one ballot. */
export async function buildReceiptPdf(input: ReceiptInput): Promise<Uint8Array> {
  const lines = receiptLines(input);
  const url = trackerUrl(input.baseUrl, lines.code);

  const doc = await newDocument("Ballot tracking receipt");
  const page = doc.addPage([RECEIPT_WIDTH, RECEIPT_HEIGHT]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.CourierBold);
  const ink = rgb(0, 0, 0);
  const width = RECEIPT_WIDTH - 2 * MARGIN;

  page.drawRectangle({ x: 0, y: 0, width: RECEIPT_WIDTH, height: RECEIPT_HEIGHT, color: RECEIPT_TINT });

  let y = RECEIPT_HEIGHT - MARGIN;
  const line = (text: string, font = regular, size = 10, gap = 4) => {
    y -= size;
    page.drawText(text, { x: MARGIN, y, size, font, color: ink });
    y -= gap;
  };

  for (const titleLine of wrapText(lines.title, bold, 9, width)) line(titleLine, bold, 9, 3);
  line(lines.precinct, regular, 10);
  line(lines.castOn, regular, 10, 12);
  line(lines.codeLabel, regular, 10, 6);
  line(lines.code, mono, fitSize(lines.code, mono, 16, width), 10);

  const png = await QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 4,
    scale: 8,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
  const qr = await doc.embedPng(png);
  y -= QR_SIZE;
  page.drawImage(qr, { x: (RECEIPT_WIDTH - QR_SIZE) / 2, y, width: QR_SIZE, height: QR_SIZE });
  y -= 10;

  line(lines.trackIt, regular, 10);
  line(lines.orCall, regular, 10, 12);
  line(lines.footer[0], regular, 9, 2);
  line(lines.footer[1], bold, 9, 0);

  return saveDocument(doc);
}
