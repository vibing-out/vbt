import { getSodium } from "./ready.js";

export type KeyPair = { publicKey: Uint8Array; secretKey: Uint8Array };

/** X25519 keypair for sealed-box ballot encryption (libsodium crypto_box_keypair). */
export async function generateElectionKeyPair(): Promise<KeyPair> {
  const sodium = await getSodium();
  const { publicKey, privateKey } = sodium.crypto_box_keypair();
  return { publicKey, secretKey: privateKey };
}

/** Ed25519 keypair for signing stage records (libsodium crypto_sign_keypair). */
export async function generateSigningKeyPair(): Promise<KeyPair> {
  const sodium = await getSodium();
  const { publicKey, privateKey } = sodium.crypto_sign_keypair();
  return { publicKey, secretKey: privateKey };
}
