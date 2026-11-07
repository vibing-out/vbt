import "server-only";

import type { ElectionManifest } from "@vbt/crypto";

// The demo election (T-05 C22): its manifest and the server's election keys. The manifest matches
// the simulator fixture (tools/simulator/src/fixture.ts) so simulator files ingest as they are.
//
// Keys come from the existing env vars (base64; Node's decoder also accepts URL-safe base64). They
// live only in Vercel, never in the repo. A missing or wrong-length key makes the routes answer 500
// server_misconfigured before they write anything.

export const ELECTION_ID = "marion-general-2026-11-03";

export const ELECTION_MANIFEST: ElectionManifest = Object.freeze({
  contests: Object.freeze([
    Object.freeze({ id: "contest-president", choices: Object.freeze([{ id: "cand-a" }, { id: "cand-b" }, { id: "cand-c" }]) }),
    Object.freeze({ id: "contest-measure-1", choices: Object.freeze([{ id: "yes" }, { id: "no" }]) }),
  ]),
});

export type ElectionKeys = {
  /** X25519, 32 bytes. Not used by the server (it never encrypts); checked so a broken deploy is caught. */
  electionPublicKey: Uint8Array;
  /** X25519, 32 bytes: aggregate tally decryption only. */
  electionSecretKey: Uint8Array;
  /** Ed25519, 64 bytes: stage-record signing. */
  signingSecretKey: Uint8Array;
};

type Env = Readonly<Record<string, string | undefined>>;

function decodeKey(value: string | undefined, length: number): Uint8Array | null {
  if (!value || value.trim() === "") return null;
  const bytes = new Uint8Array(Buffer.from(value.trim(), "base64"));
  return bytes.length === length ? bytes : null;
}

/** The election keys from env, or null when any is missing or the wrong length. */
export function loadElectionKeys(env: Env = process.env): ElectionKeys | null {
  const electionPublicKey = decodeKey(env.ELECTION_PUBLIC_KEY, 32);
  const electionSecretKey = decodeKey(env.ELECTION_SECRET_KEY, 32);
  const signingSecretKey = decodeKey(env.STAGE_SIGNING_SECRET_KEY, 64);
  if (!electionPublicKey || !electionSecretKey || !signingSecretKey) return null;
  return { electionPublicKey, electionSecretKey, signingSecretKey };
}

/**
 * The Ed25519 public key that checks stage-record signatures: STAGE_SIGNING_PUBLIC_KEY, or else the
 * public half of STAGE_SIGNING_SECRET_KEY (libsodium's 64-byte secret key is seed || public key).
 * Null when neither is set.
 */
export function loadStageSigningPublicKey(env: Env = process.env): Uint8Array | null {
  const publicKey = decodeKey(env.STAGE_SIGNING_PUBLIC_KEY, 32);
  if (publicKey) return publicKey;
  const secretKey = decodeKey(env.STAGE_SIGNING_SECRET_KEY, 64);
  return secretKey ? secretKey.slice(32) : null;
}
