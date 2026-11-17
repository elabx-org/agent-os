/**
 * A linked machine's identity: an Ed25519 key pair made on the machine.
 * The private half never leaves it; the hub stores the public half and
 * checks a signature over its own nonce each time the machine connects.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from "crypto";

/** DER prefix of an Ed25519 SubjectPublicKeyInfo, before the 32 raw bytes */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface MachineKey {
  /** Raw 32-byte public key, base64url */
  publicKey: string;
  /** PKCS#8 DER, base64url */
  privateKey: string;
}

export function generateMachineKey(): MachineKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  return {
    publicKey: spki.subarray(SPKI_PREFIX.length).toString("base64url"),
    privateKey: privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64url"),
  };
}

export function isPublicKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value, "base64url").length === 32
  );
}

export function signProof(privateKey: string, text: string): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKey, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  return sign(null, Buffer.from(text), key).toString("base64url");
}

export function verifyProof(
  publicKey: string,
  text: string,
  signature: string
): boolean {
  if (!isPublicKey(publicKey) || typeof signature !== "string") return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey, "base64url")]),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      Buffer.from(text),
      key,
      Buffer.from(signature, "base64url")
    );
  } catch {
    return false;
  }
}

/** Four digits both sides show while a machine waits for approval, e.g. "48 21" */
export function matchCode(publicKey: string): string {
  const digest = createHash("sha256")
    .update(Buffer.from(publicKey, "base64url"))
    .digest();
  const digits = String(digest.readUInt32BE(0) % 10000).padStart(4, "0");
  return `${digits.slice(0, 2)} ${digits.slice(2)}`;
}

export function newNonce(): string {
  return randomBytes(24).toString("base64url");
}

/** A one-time code for adding a machine: 10 characters, no look-alikes */
export function newPairingCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
