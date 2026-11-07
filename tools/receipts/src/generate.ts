// Two PDFs per ballot: the voter's receipt and the paper ballot record for the box.
//
// On disk the two halves stay unlinked: receipts are named by tracking code, paper ballot records by a
// random id, and records are written in shuffled order so file names and write times don't pair them.

import { randomInt, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BallotEntry, ReceiptsInput } from "./input.ts";
import { buildPaperBallotPdf } from "./paper-ballot.ts";
import { buildReceiptPdf } from "./receipt.ts";

export interface GenerateOptions {
  baseUrl: string;
  phone?: string;
  /** Only these tracking codes; all ballots when omitted. */
  codes?: string[];
}

export interface BallotDocuments {
  trackingCode: string;
  receipt: Uint8Array;
  paperBallot: Uint8Array;
}

function selectBallots(input: ReceiptsInput, codes: string[] | undefined): BallotEntry[] {
  if (!codes || codes.length === 0) return input.ballots;
  const missing = codes.filter((c) => !input.ballots.some((b) => b.tracking_code === c));
  if (missing.length > 0) throw new Error(`No ballot with tracking code: ${missing.join(", ")}`);
  return input.ballots.filter((b) => codes.includes(b.tracking_code));
}

/** Builds both PDFs for each selected ballot, in memory. */
export async function generateBallotDocuments(input: ReceiptsInput, options: GenerateOptions): Promise<BallotDocuments[]> {
  const precinctName = new Map(input.precincts.map((p) => [p.id, p.name]));
  const results: BallotDocuments[] = [];
  for (const ballot of selectBallots(input, options.codes)) {
    const name = precinctName.get(ballot.precinct_id);
    if (name === undefined) throw new Error(`Unknown precinct ${ballot.precinct_id}`);
    const receipt = await buildReceiptPdf({
      trackingCode: ballot.tracking_code,
      precinctId: ballot.precinct_id,
      precinctName: name,
      castDate: ballot.cast_date,
      countyName: input.election.county_name,
      electionName: input.election.name,
      electionDate: input.election.date,
      baseUrl: options.baseUrl,
      ...(options.phone ? { phone: options.phone } : {}),
    });
    const paperBallot = await buildPaperBallotPdf({
      machineId: ballot.machine_id,
      precinctId: ballot.precinct_id,
      precinctName: name,
      ballotStyle: ballot.ballot_style,
      castDate: ballot.cast_date,
      countyName: input.election.county_name,
      electionName: input.election.name,
      manifest: input.manifest,
      choices: ballot.choices,
    });
    results.push({ trackingCode: ballot.tracking_code, receipt, paperBallot });
  }
  return results;
}

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export interface WrittenFiles {
  receipts: string[];
  paperBallots: string[];
}

/** Writes `<outDir>/receipts/<code>.pdf` and `<outDir>/paper-ballots/<random id>.pdf`. */
export async function writeBallotDocuments(docs: BallotDocuments[], outDir: string): Promise<WrittenFiles> {
  const receiptDir = join(outDir, "receipts");
  const paperDir = join(outDir, "paper-ballots");
  await mkdir(receiptDir, { recursive: true });
  await mkdir(paperDir, { recursive: true });

  const receipts: string[] = [];
  for (const doc of docs) {
    const file = join(receiptDir, `${doc.trackingCode}.pdf`);
    await writeFile(file, doc.receipt);
    receipts.push(file);
  }
  const paperBallots: string[] = [];
  for (const doc of shuffled(docs)) {
    const file = join(paperDir, `${randomUUID()}.pdf`);
    await writeFile(file, doc.paperBallot);
    paperBallots.push(file);
  }
  return { receipts, paperBallots };
}
