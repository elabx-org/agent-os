/**
 * How this server marks its own "keep matching" calls to a linked
 * machine (lib/claude-setup/hub.ts). On its own so lib/link/server.ts
 * can read it without the rest. Server only.
 */

import { randomBytes, timingSafeEqual } from "crypto";

/** Dropped before a request goes down the link (x-agentos-link*) */
export const SETUP_PROOF_HEADER = "x-agentos-link-setup";
/** Reaches the machine: this copy is "keep matching", not the user's tap */
export const SETUP_FOLLOW_HEADER = "x-agentos-setup-follow";
/** Its owner's choice to replace their own versions: only with the user's proof */
export const SETUP_FORCE_HEADER = "x-agentos-setup-force";
export const SETUP_PATH = /^\/api\/claude-setup(\/receive|\/pack)?(\?|$)/;

const shared = globalThis as typeof globalThis & {
  __agentosSetupProof?: string;
};

/** Per boot: marks this server's own "keep matching" calls to a machine */
export function setupProof(): string {
  shared.__agentosSetupProof ??= randomBytes(32).toString("base64url");
  return shared.__agentosSetupProof;
}

export function isSetupProof(value: string | null | undefined): boolean {
  if (!value) return false;
  const given = Buffer.from(value);
  const expected = Buffer.from(setupProof());
  return given.length === expected.length && timingSafeEqual(given, expected);
}
