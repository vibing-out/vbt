import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_TRACKER_BASE_URL } from "./config.ts";
import { exampleInput } from "./fixtures.ts";
import { generateBallotDocuments, writeBallotDocuments } from "./generate.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("generator", () => {
  it("writes two PDFs per ballot, with paper ballot file names that don't carry the code", async () => {
    const input = exampleInput();
    const out = await mkdtemp(join(tmpdir(), "vbt-receipts-"));
    dirs.push(out);
    const docs = await generateBallotDocuments(input, { baseUrl: DEFAULT_TRACKER_BASE_URL });
    const written = await writeBallotDocuments(docs, out);

    const receipts = (await readdir(join(out, "receipts"))).sort();
    const papers = await readdir(join(out, "paper-ballots"));
    expect(receipts).toEqual(input.ballots.map((b) => `${b.tracking_code}.pdf`).sort());
    expect(papers).toHaveLength(input.ballots.length);
    for (const name of papers) {
      expect(name).toMatch(/^[0-9a-f-]{36}\.pdf$/);
      for (const b of input.ballots) expect(name).not.toContain(b.tracking_code);
    }
    expect(written.paperBallots.map((f) => basename(f)).sort()).toEqual([...papers].sort());

    const first = await readFile(join(out, "receipts", "SEED-0001.pdf"));
    expect(first.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("generates only the requested codes, and reports unknown ones", async () => {
    const input = exampleInput();
    const docs = await generateBallotDocuments(input, { baseUrl: DEFAULT_TRACKER_BASE_URL, codes: ["SEED-0018"] });
    expect(docs.map((d) => d.trackingCode)).toEqual(["SEED-0018"]);
    await expect(
      generateBallotDocuments(input, { baseUrl: DEFAULT_TRACKER_BASE_URL, codes: ["NOPE-1"] }),
    ).rejects.toThrow(/NOPE-1/);
  });
});
