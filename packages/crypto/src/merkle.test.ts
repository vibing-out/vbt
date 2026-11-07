// AC3: 1000-leaf Merkle proofs verify; tamper fails.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildMerkleTree, verifyInclusionProof } from "./index.js";
import { EMPTY_TREE_ROOT, hashLeaf, hashNode } from "./merkle.js";
import { flipByte } from "./fixtures.test-helpers.js";

const sha = (...parts: number[][]) => new Uint8Array(createHash("sha256").update(Buffer.from(parts.flat())).digest());
const leafBytes = (i: number) => new TextEncoder().encode(`ballot-${i}`);

describe("Merkle tree (AC3)", () => {
  const leaves = Array.from({ length: 1000 }, (_, i) => leafBytes(i));
  const { root, proofs } = buildMerkleTree(leaves);

  it("every proof in a 1000-leaf tree verifies", () => {
    expect(root).toHaveLength(32);
    expect(proofs).toHaveLength(1000);
    leaves.forEach((leaf, i) => {
      expect(proofs[i]?.leafIndex).toBe(i);
      expect(proofs[i]!.steps.length).toBeLessThanOrEqual(10);
      expect(verifyInclusionProof(leaf, proofs[i]!, root)).toBe(true);
    });
  });

  it("a tampered leaf fails", () => {
    leaves.forEach((leaf, i) => {
      expect(verifyInclusionProof(flipByte(leaf, 0), proofs[i]!, root)).toBe(false);
    });
  });

  it("a tampered sibling, flipped side, dropped step or wrong root fails", () => {
    const i = 537;
    const proof = proofs[i]!;
    const leaf = leaves[i]!;
    proof.steps.forEach((step, s) => {
      const steps = proof.steps.slice();
      steps[s] = { ...step, sibling: flipByte(step.sibling, 5) };
      expect(verifyInclusionProof(leaf, { steps }, root)).toBe(false);
      const flipped = proof.steps.slice();
      flipped[s] = { ...step, side: step.side === "left" ? "right" : "left" };
      expect(verifyInclusionProof(leaf, { steps: flipped }, root)).toBe(false);
    });
    expect(verifyInclusionProof(leaf, { steps: proof.steps.slice(1) }, root)).toBe(false);
    expect(verifyInclusionProof(leaf, proof, flipByte(root, 31))).toBe(false);
    expect(verifyInclusionProof(leaf, proofs[i + 1]!, root)).toBe(false);
  });

  it("returns false rather than throwing on malformed proofs", () => {
    const leaf = leaves[0]!;
    expect(verifyInclusionProof(leaf, { steps: [{ sibling: new Uint8Array(3), side: "left" }] }, root)).toBe(false);
    expect(verifyInclusionProof(leaf, { steps: [{ sibling: root, side: "up" as never }] }, root)).toBe(false);
    expect(verifyInclusionProof(leaf, null as never, root)).toBe(false);
    expect(verifyInclusionProof(leaf, proofs[0]!, new Uint8Array(4))).toBe(false);
  });

  it("matches the frozen construction: 0x00 leaf prefix, 0x01 node prefix, odd node promoted", () => {
    const [a, b, c] = [[0x61], [0x62], [0x63]];
    const ha = sha([0x00], a!);
    const hb = sha([0x00], b!);
    const hc = sha([0x00], c!);
    expect(hashLeaf(Uint8Array.from(a!))).toEqual(ha);
    const hab = sha([0x01], [...ha], [...hb]);
    expect(hashNode(ha, hb)).toEqual(hab);
    // Three leaves: c is promoted unchanged, root = H(0x01 || H(ab) || hc).
    const tree = buildMerkleTree([a, b, c].map((x) => Uint8Array.from(x!)));
    expect(tree.root).toEqual(sha([0x01], [...hab], [...hc]));
    expect(tree.proofs[2]!.steps).toEqual([{ sibling: hab, side: "left" }]);
    expect(tree.proofs[0]!.steps).toEqual([
      { sibling: hb, side: "right" },
      { sibling: hc, side: "right" },
    ]);
  });

  it("handles single-leaf and empty trees", () => {
    const one = buildMerkleTree([leafBytes(1)]);
    expect(one.root).toEqual(hashLeaf(leafBytes(1)));
    expect(one.proofs[0]!.steps).toEqual([]);
    expect(verifyInclusionProof(leafBytes(1), one.proofs[0]!, one.root)).toBe(true);
    const none = buildMerkleTree([]);
    expect(none.root).toEqual(EMPTY_TREE_ROOT);
    expect(none.proofs).toEqual([]);
  });

  it("is deterministic and order-sensitive", () => {
    expect(buildMerkleTree(leaves).root).toEqual(root);
    expect(buildMerkleTree(leaves.slice().reverse()).root).not.toEqual(root);
  });
});
