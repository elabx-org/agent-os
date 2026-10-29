/**
 * Proof that a request comes from the user's browser, not an agent: a
 * per-boot secret in an HttpOnly cookie that server.ts issues only on
 * same-origin page navigations. Agents run as the same Unix user, so this
 * raises the bar to deliberate header forgery; it isn't isolation.
 */

import type { IncomingMessage, ServerResponse } from "http";

export const USER_PROOF_COOKIE = "agentos_u";

/** Same-origin page the client loads in a hidden iframe to get a fresh cookie */
export const USER_PROOF_PATH = "/api/user-proof";

export type UserProofFailure =
  | "agent_origin"
  | "cross_site"
  | "no_proof"
  | "no_session";

export type UserProof = { ok: true } | { ok: false; reason: UserProofFailure };

/** The per-boot secret (random 32 bytes on globalThis, never on disk) */
export function userSecret(): string {
  throw new Error("not implemented");
}

/** For route handlers (Web Request / NextRequest); fails closed */
export function requireUser(_req: Request): UserProof {
  return { ok: false, reason: "no_proof" };
}

/** server.ts: sets the cookie on same-origin document/iframe navigations */
export function issueUserProof(
  _req: IncomingMessage,
  _res: ServerResponse
): void {}
