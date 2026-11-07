// AC 1 and AC 3 (T-15a): docs/record-format.md covers what an independent verifier needs, and
// tools/verifier/README.md links it.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const docUrl = new URL("../../../docs/record-format.md", import.meta.url);
const doc = existsSync(docUrl) ? readFileSync(docUrl, "utf8") : "";
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("docs/record-format.md", () => {
  test("exists", () => {
    expect(doc.length).toBeGreaterThan(0);
  });

  test("documents every stage record JSON field", () => {
    for (const field of ["scope", "scope_id", "stage", "merkle_root", "ballot_count", "totals", "published_on", "signature", "ballots", "tracking_code", "ciphertext_hash"]) {
      expect(doc).toContain(`| \`${field}\``);
    }
  });

  test("documents the Merkle tree: hash function, leaf encoding, node hashing and leaf order", () => {
    expect(doc).toMatch(/## 4\. Hash function\s+SHA-256/);
    expect(doc).toContain("leaf = UTF-8(tracking_code) || 0x00 || bytes(ciphertext_hash)");
    expect(doc).toContain("leafHash(leaf)          = SHA-256(0x00 || leaf)");
    expect(doc).toContain("nodeHash(left, right)   = SHA-256(0x01 || left || right)");
    expect(doc).toMatch(/### 5\.3 Leaf order\s+Leaves are ordered by:\s+1\. `ciphertext_hash` ascending/);
    expect(doc).toContain("promoted");
    expect(doc).toContain("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("does not present the superseded bare-hash leaves as the convention", () => {
    expect(doc).not.toMatch(/^Merkle leaves are the 32 bytes of each `ciphertext_hash`/m);
    expect(doc).toContain("The bare-hash leaf convention is superseded");
  });

  test("documents what the signature covers and that the key comes from the election office, not the server", () => {
    expect(doc).toContain("Ed25519");
    expect(doc).toContain('{"ballotCount":500,"merkleRoot":"<64 hex>","scope":"precinct","stage":"TALLIED_PRECINCT","totals"');
    expect(doc).toContain("**Get the key from the election office**");
    expect(doc).toContain("**Never take it from the server whose record you are checking.**");
  });

  test("documents inclusion proofs and C2 to C4", () => {
    expect(doc).toContain("## 7. Inclusion proofs");
    expect(doc).toMatch(/if step\.side == "left":\s+h = nodeHash\(bytes\(step\.hash\), h\)/);
    for (const check of ["**C2: precinct totals.**", "**C3: election-night totals.**", "**C4: certification.**"]) {
      expect(doc).toContain(check);
    }
  });

  test("never shows a time of day in an example", () => {
    expect(doc).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
  });
});

describe("tools/verifier/README.md", () => {
  test("links docs/record-format.md", () => {
    expect(readme).toContain("](../../docs/record-format.md)");
  });
});
