/**
 * How this server marks its own background calls to a linked machine's
 * inbox (lib/backup/hub-send.ts): a per-boot proof on its loopback, which
 * lib/link/server.ts checks and never sends down the link (x-agentos-link*).
 * The machine's link client then vouches for the call to its own server
 * (lib/link/up-guard.ts), the way this server vouches for a machine's.
 * Server only.
 */

import { randomBytes, timingSafeEqual } from "crypto";

export const OWN_PROOF_HEADER = "x-agentos-link-own";
/** Only a machine's inbox: nothing else is this server's own call */
export const OWN_PATH = /^\/api\/link\/inbox\/(backup|peer|job)\/[^\s]*$/;

const shared = globalThis as typeof globalThis & {
  __agentosOwnProof?: string;
};

export function ownProof(): string {
  shared.__agentosOwnProof ??= randomBytes(32).toString("base64url");
  return shared.__agentosOwnProof;
}

export function isOwnProof(value: string | null | undefined): boolean {
  if (!value) return false;
  const given = Buffer.from(value);
  const expected = Buffer.from(ownProof());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A request on this server's loopback that is its own call to a machine */
export const isOwnCall = (
  path: string,
  proof: string | null | undefined
): boolean => OWN_PATH.test(path) && isOwnProof(proof);
