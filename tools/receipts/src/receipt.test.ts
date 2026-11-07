import { describe, expect, it } from "vitest";
import { DEFAULT_TRACKER_BASE_URL, PLACEHOLDER_PHONE } from "./config.ts";
import { choiceStrings, exampleInput } from "./fixtures.ts";
import { generateBallotDocuments } from "./generate.ts";
import { buildReceiptPdf, receiptLines, type ReceiptInput } from "./receipt.ts";
import { decodeQrCodes, extractPdf, PDF_DATE_WITH_TIME, TIME_OF_DAY, wholeWord } from "./test-support.ts";

const input = exampleInput();
const ballot = input.ballots[0]!;

const receiptInput: ReceiptInput = {
  trackingCode: ballot.tracking_code,
  precinctId: ballot.precinct_id,
  precinctName: "Center 1",
  castDate: ballot.cast_date,
  countyName: input.election.county_name,
  electionName: input.election.name,
  electionDate: input.election.date,
  baseUrl: DEFAULT_TRACKER_BASE_URL,
};

describe("AC1: the receipt's QR code opens the tracker for that code", () => {
  it("decodes to <base>/track/<code> with the default base URL", async () => {
    const pdf = await buildReceiptPdf(receiptInput);
    expect(await decodeQrCodes(pdf)).toEqual(["https://www.ballottrack.org/track/SEED-0001"]);
  });

  it("uses a configured base URL, and the code exactly as stored", async () => {
    const pdf = await buildReceiptPdf({
      ...receiptInput,
      trackingCode: "RIVER-MAPLE-7Q4K-HAWK",
      baseUrl: "https://preview.example.vercel.app/",
    });
    expect(await decodeQrCodes(pdf)).toEqual(["https://preview.example.vercel.app/track/RIVER-MAPLE-7Q4K-HAWK"]);
  });

  it("decodes on every generated receipt from the example input", async () => {
    const docs = await generateBallotDocuments(input, { baseUrl: DEFAULT_TRACKER_BASE_URL });
    expect(docs).toHaveLength(input.ballots.length);
    for (const doc of docs) {
      expect(await decodeQrCodes(doc.receipt)).toEqual([`${DEFAULT_TRACKER_BASE_URL}/track/${doc.trackingCode}`]);
    }
  });

  it("prints the QR code large enough to scan on a phone (at least 1.5 inches)", async () => {
    const { images } = await extractPdf(await buildReceiptPdf(receiptInput));
    expect(images).toHaveLength(1);
    expect(images[0]!.width).toBeGreaterThanOrEqual(108);
    expect(images[0]!.height).toBeGreaterThanOrEqual(108);
  });

  it("refuses a tracking code that would not survive a URL path as-is", async () => {
    await expect(buildReceiptPdf({ ...receiptInput, trackingCode: "SEED 0001" })).rejects.toThrow(/tracking_code/);
    await expect(buildReceiptPdf({ ...receiptInput, trackingCode: "../admin" })).rejects.toThrow(/tracking_code/);
  });
});

describe("AC2: the receipt contains no ballot choices or time", () => {
  it("has no choices, time of day, or machine ID in its text, for every ballot", async () => {
    const docs = await generateBallotDocuments(input, { baseUrl: DEFAULT_TRACKER_BASE_URL });
    const forbidden = [...choiceStrings(input), ...input.ballots.map((b) => b.machine_id)];
    for (const doc of docs) {
      const { text } = await extractPdf(doc.receipt);
      expect(text).toContain(doc.trackingCode); // the extraction works
      for (const s of forbidden) expect(text).not.toMatch(wholeWord(s));
      expect(text).not.toMatch(TIME_OF_DAY);
    }
  });

  it("carries no CreationDate or ModDate, and no PDF date with a time", async () => {
    const pdf = await buildReceiptPdf(receiptInput);
    const { info } = await extractPdf(pdf);
    expect(info.CreationDate).toBeUndefined();
    expect(info.ModDate).toBeUndefined();
    for (const value of Object.values(info)) expect(String(value)).not.toMatch(TIME_OF_DAY);

    const raw = Buffer.from(pdf).toString("latin1");
    expect(raw).not.toContain("/CreationDate");
    expect(raw).not.toContain("/ModDate");
    expect(raw).not.toMatch(PDF_DATE_WITH_TIME);
  });

  it("produces identical bytes whenever it is generated, so the file itself can't date the ballot", async () => {
    const a = await buildReceiptPdf(receiptInput);
    await new Promise((r) => setTimeout(r, 1100));
    const b = await buildReceiptPdf(receiptInput);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("refuses a cast date that carries a time", async () => {
    await expect(buildReceiptPdf({ ...receiptInput, castDate: "2026-11-03T07:42:00Z" })).rejects.toThrow(/no time/);
    await expect(buildReceiptPdf({ ...receiptInput, castDate: "2026-11-03 07:42" })).rejects.toThrow(/no time/);
  });
});

describe("AC3: the layout matches the receipt mockup", () => {
  it("contains the title, precinct, cast date, readable code, web address, phone line and footer", async () => {
    const { text } = await extractPdf(await buildReceiptPdf(receiptInput));
    expect(text).toContain("MARION COUNTY GENERAL ELECTION · NOV 3, 2026");
    expect(text).toContain("Precinct Center 1 (18097-001)");
    expect(text).toContain("Cast on Nov 3, 2026");
    expect(text).toContain("Your ballot tracking code:");
    expect(text).toContain("SEED-0001");
    expect(text).toContain("Track it: www.ballottrack.org/track");
    expect(text).toContain(`Or call: ${PLACEHOLDER_PHONE}`);
    expect(PLACEHOLDER_PHONE).toBe("(317) 555-0100");
    expect(text).toContain("This code shows your ballot's progress.");
    expect(text).toContain("It does not show how you voted.");
  });

  it("prints the web address of a configured base URL", async () => {
    const { text } = await extractPdf(await buildReceiptPdf({ ...receiptInput, baseUrl: "http://localhost:3000" }));
    expect(text).toContain("Track it: localhost:3000/track");
  });

  it("orders the parts top to bottom as the mockup does: title, precinct, code, QR, address, phone, footer", async () => {
    const { lines, images } = await extractPdf(await buildReceiptPdf(receiptInput));
    const yOf = (needle: string) => {
      const line = lines.find((l) => l.text.includes(needle));
      if (!line) throw new Error(`missing line: ${needle}`);
      return line.y;
    };
    const qr = images[0]!;
    const order = [
      yOf("MARION COUNTY"),
      yOf("Precinct"),
      yOf("Your ballot tracking code:"),
      yOf("SEED-0001"),
      qr.y + qr.height, // top of the QR code
      qr.y, // bottom of the QR code
      yOf("Track it:"),
      yOf("Or call:"),
      yOf("does not show how you voted"),
    ];
    for (let i = 1; i < order.length; i++) expect(order[i]!).toBeLessThan(order[i - 1]!);
  });

  it("prints the code exactly as stored, and leaves out the stretch-ticket lines", async () => {
    const lines = receiptLines(receiptInput);
    expect(lines.code).toBe("SEED-0001");
    const { text } = await extractPdf(await buildReceiptPdf(receiptInput));
    expect(text).not.toContain("Phone code");
    expect(text).not.toContain("Text updates");
  });
});

describe("every receipt line stays on the 4-inch slip", () => {
  const MARGIN = 0.3 * 72;

  async function expectInsideSlip(pdf: Uint8Array) {
    const { lines, pageWidth } = await extractPdf(pdf);
    expect(pageWidth).toBe(4 * 72);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.left, line.text).toBeGreaterThanOrEqual(0);
      // Inside the page and inside the printable area, so a printer's margin doesn't clip it.
      expect(line.right, line.text).toBeLessThanOrEqual(pageWidth);
      expect(line.right, line.text).toBeLessThanOrEqual(pageWidth - MARGIN + 0.5);
      expect(line.y, line.text).toBeGreaterThan(0);
    }
    return lines;
  }

  it("for every receipt generated from the example input", async () => {
    const docs = await generateBallotDocuments(input, { baseUrl: DEFAULT_TRACKER_BASE_URL });
    for (const doc of docs) await expectInsideSlip(doc.receipt);
  });

  it("wraps a long precinct name instead of running off the edge", async () => {
    const precinctName = "Washington Township Northeast Consolidated Fire District Annex 14";
    const lines = await expectInsideSlip(await buildReceiptPdf({ ...receiptInput, precinctName }));
    const text = lines.map((l) => l.text).join(" ");
    expect(text).toContain(`Precinct ${precinctName} (18097-001)`); // every word printed, in order
    const precinctLines = lines.filter((l) => /Precinct|Annex|18097-001/.test(l.text));
    expect(precinctLines.length).toBeGreaterThan(1);
  });

  it("fits a long tracker address and phone line, and the QR code still opens the tracker", async () => {
    const baseUrl = "https://vbt-git-task-t-07-paper-ballot-receipt-vibing-out.preview.example.vercel.app";
    const phone = "(317) 555-0100 ext. 4400, Marion County Election Board voter line";
    const pdf = await buildReceiptPdf({ ...receiptInput, baseUrl, phone });
    const lines = await expectInsideSlip(pdf);
    const text = lines.map((l) => l.text).join(" ");
    expect(text).toContain(`Track it: ${baseUrl.replace("https://", "")}/track`);
    expect(text).toContain(`Or call: ${phone}`);
    expect(text).toContain("It does not show how you voted."); // the footer survives
    expect(await decodeQrCodes(pdf)).toEqual([`${baseUrl}/track/SEED-0001`]);
  });

  it("fits a long county and election name in the title", async () => {
    await expectInsideSlip(
      await buildReceiptPdf({
        ...receiptInput,
        countyName: "Consolidated City of Indianapolis and Marion County",
        electionName: "Special Municipal and School Referendum Election",
      }),
    );
  });

  it("refuses text too long to fit, rather than printing past the bottom edge", async () => {
    await expect(buildReceiptPdf({ ...receiptInput, precinctName: "Annex ".repeat(200) })).rejects.toThrow(
      /does not fit/,
    );
  });

  it("leaves a receipt that already fits unchanged", () => {
    const lines = receiptLines(receiptInput);
    expect(lines.trackIt).toBe("Track it:  www.ballottrack.org/track");
    expect(lines.orCall).toBe(`Or call:   ${PLACEHOLDER_PHONE}`);
  });
});
