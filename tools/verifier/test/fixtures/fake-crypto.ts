// TEST DOUBLE ONLY. Stands in for @vbt/crypto until E3 is on this branch, so
// fixtures can be built and signed. It follows the epic/4 algorithms
// (SHA-256 Merkle tree with 0x00/0x01 domain separation, Ed25519 over the
// canonical JSON of scope, stage, merkleRoot, ballotCount and totals), but it
// is not production code: nothing under src/ imports it, and the CLI uses the
// real adapter in src/crypto.ts.

import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import type { CryptoAdapter, InclusionProof, StageRecord } from "../../src/crypto.ts";

export const sha256 = (...parts: Uint8Array[]): Uint8Array => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};

const hashLeaf = (leaf: Uint8Array) => sha256(Uint8Array.of(0), leaf);
const hashNode = (l: Uint8Array, r: Uint8Array) => sha256(Uint8Array.of(1), l, r);
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

function buildMerkleTree(leaves: readonly Uint8Array[]): { root: Uint8Array; proofs: InclusionProof[] } {
  if (leaves.length === 0) return { root: sha256(), proofs: [] };
  const levels: Uint8Array[][] = [leaves.map(hashLeaf)];
  for (let level = levels[0] as Uint8Array[]; level.length > 1; ) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const right = level[i + 1];
      next.push(right ? hashNode(level[i] as Uint8Array, right) : (level[i] as Uint8Array));
    }
    levels.push(next);
    level = next;
  }
  const proofs = leaves.map((_, leafIndex): InclusionProof => {
    const steps: InclusionProof["steps"] = [];
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

function verifyInclusionProof(leaf: Uint8Array, proof: InclusionProof, root: Uint8Array): boolean {
  let hash = hashLeaf(leaf);
  for (const step of proof.steps) {
    if (step.sibling.length !== 32) return false;
    hash = step.side === "left" ? hashNode(step.sibling, hash) : hashNode(hash, step.sibling);
  }
  return eq(hash, root);
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

const recordBytes = ({ scope, stage, merkleRoot, ballotCount, totals }: StageRecord) =>
  Buffer.from(canonical({ scope, stage, merkleRoot, ballotCount, totals }), "utf8");

/** A throwaway Ed25519 signer for fixtures. */
export type FakeSigner = { publicKey: Uint8Array; sign(record: StageRecord): Uint8Array };

export function throwawaySigner(): FakeSigner {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { publicKey: new Uint8Array(raw), sign: (r) => new Uint8Array(sign(null, recordBytes(r), privateKey)) };
}

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export const fakeCrypto: CryptoAdapter = {
  ready: async () => {},
  isTrackingCode: (code: unknown): code is string =>
    typeof code === "string" && /^[A-Z]{3,8}-[A-Z]{3,8}-[0-9A-HJKMNP-TV-Z]{4}-[A-Z]{3,8}$/.test(code),
  buildMerkleTree,
  verifyInclusionProof,
  verifyStageRecord: async (record, signature, signingPublicKey) => {
    if (signature.length !== 64 || signingPublicKey.length !== 32) return false;
    const der = Buffer.concat([SPKI_ED25519_PREFIX, signingPublicKey]);
    try {
      return verify(null, recordBytes(record), { key: der, format: "der", type: "spki" }, signature);
    } catch {
      return false;
    }
  },
};
