// Generates the demo's printable paper: a receipt and a paper ballot record per ballot.
//
// Usage (from tools/receipts):
//   node src/cli.ts --input examples/demo-ballots.json [--out out] [--code SEED-0001 ...]
//   pnpm --filter @vbt/receipts generate --input examples/demo-ballots.json
// Env: RECEIPT_TRACKER_BASE_URL (optional; defaults to https://www.ballottrack.org). The QR code opens
// <base>/track/<tracking_code>.

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { trackerBaseUrl } from "./config.ts";
import { generateBallotDocuments, writeBallotDocuments } from "./generate.ts";
import { parseInput } from "./input.ts";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    out: { type: "string", default: "out" },
    code: { type: "string", multiple: true },
  },
});

if (!values.input) {
  console.error("Usage: node src/cli.ts --input <ballots.json> [--out <dir>] [--code <tracking code> ...]");
  process.exit(2);
}

const input = parseInput(JSON.parse(await readFile(values.input, "utf8")));
const baseUrl = trackerBaseUrl();
const docs = await generateBallotDocuments(input, { baseUrl, ...(values.code ? { codes: values.code } : {}) });
const written = await writeBallotDocuments(docs, values.out);
console.log(`Wrote ${written.receipts.length} receipt(s) and ${written.paperBallots.length} paper ballot record(s) to ${values.out}`);
console.log(`QR codes open ${baseUrl}/track/<tracking_code>`);
