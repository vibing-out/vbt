import { assertBytes, bytesEqual, HASH_BYTES, sha256 } from "./internal/bytes.js";

const LEAF_PREFIX = Uint8Array.of(0x00);
const NODE_PREFIX = Uint8Array.of(0x01);

/** One step of an inclusion proof: the sibling hash and which side it sits on. */
export type ProofStep = { sibling: Uint8Array; side: "left" | "right" };

export type InclusionProof = {
  /** Position of the leaf in the input order. Informational; not needed to verify. */
  leafIndex?: number;
  /** Siblings from the leaf level up to (not including) the root. */
  steps: ProofStep[];
};

/** SHA-256(0x00 || leaf). */
export function hashLeaf(leaf: Uint8Array): Uint8Array {
  return sha256(LEAF_PREFIX, leaf);
}

/** SHA-256(0x01 || left || right). */
export function hashNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(NODE_PREFIX, left, right);
}

/** Root of a tree with no leaves: SHA-256 of the empty string (no prefix, so it cannot equal a leaf or node hash). */
export const EMPTY_TREE_ROOT: Uint8Array = sha256();

/**
 * Binary SHA-256 Merkle tree over the leaves in the given order. Leaves are
 * domain-separated from internal nodes. A node without a partner is promoted
 * to the next level unchanged (it is not hashed with itself).
 */
export function buildMerkleTree(leaves: readonly Uint8Array[]): { root: Uint8Array; proofs: InclusionProof[] } {
  if (!Array.isArray(leaves)) throw new TypeError("leaves must be an array");
  leaves.forEach((leaf, i) => assertBytes(leaf, `leaves[${i}]`));
  if (leaves.length === 0) return { root: EMPTY_TREE_ROOT.slice(), proofs: [] };

  const levels: Uint8Array[][] = [leaves.map(hashLeaf)];
  for (let level = levels[0] as Uint8Array[]; level.length > 1; ) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i] as Uint8Array;
      const right = level[i + 1];
      next.push(right ? hashNode(left, right) : left);
    }
    levels.push(next);
    level = next;
  }

  const proofs = leaves.map((_, leafIndex): InclusionProof => {
    const steps: ProofStep[] = [];
    let index = leafIndex;
    for (const level of levels.slice(0, -1)) {
      const isRight = index % 2 === 1;
      const sibling = level[isRight ? index - 1 : index + 1];
      if (sibling) steps.push({ sibling, side: isRight ? "left" : "right" });
      index = Math.floor(index / 2);
    }
    return { leafIndex, steps };
  });

  return { root: (levels.at(-1) as Uint8Array[])[0] as Uint8Array, proofs };
}

/** Recompute the root from a leaf and its proof. Returns false (never throws) on any mismatch or malformed input. */
export function verifyInclusionProof(leaf: Uint8Array, proof: InclusionProof, root: Uint8Array): boolean {
  if (!(leaf instanceof Uint8Array) || !(root instanceof Uint8Array) || root.length !== HASH_BYTES) return false;
  if (!proof || !Array.isArray(proof.steps)) return false;
  let hash = hashLeaf(leaf);
  for (const step of proof.steps) {
    if (!step || !(step.sibling instanceof Uint8Array) || step.sibling.length !== HASH_BYTES) return false;
    if (step.side === "left") hash = hashNode(step.sibling, hash);
    else if (step.side === "right") hash = hashNode(hash, step.sibling);
    else return false;
  }
  return bytesEqual(hash, root);
}
