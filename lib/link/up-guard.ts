/**
 * The hub's check that a request came up the link from AgentOS itself
 * (the "system" kind, lib/link/up.ts), not from a session or a tool. The
 * hub adds a per-boot proof and the tunnel's machine id to those calls
 * only; nothing a machine sends can set them.
 */

import { randomBytes, timingSafeEqual } from "crypto";
import { machineById, type MachineRow } from "./store";
import { UP_ERRORS } from "./up";

export const LINK_PROOF_HEADER = "x-agentos-link-proof";
export const LINK_MACHINE_HEADER = "x-agentos-link-machine";

// server.ts and the Next route bundles are separate module graphs in one
// process: the secret lives on globalThis so both see the same one
const shared = globalThis as typeof globalThis & {
  __agentosLinkProof?: string;
};

/** The per-boot proof (random 32 bytes on globalThis, never on disk or in a log) */
export function linkProof(): string {
  shared.__agentosLinkProof ??= randomBytes(32).toString("hex");
  return shared.__agentosLinkProof;
}

function isProof(value: string | null): boolean {
  if (!value) return false;
  const expected = Buffer.from(linkProof());
  const given = Buffer.from(value);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// A plain Response, not NextResponse: server.ts (no Next) reads linkProof here
const refused = () =>
  Response.json(
    {
      error: UP_ERRORS.not_allowed_from_machine,
      code: "not_allowed_from_machine",
    },
    { status: 403, headers: { "Cache-Control": "no-store" } }
  );

/** For /api/link/inbox/*: the machine the hub's tunnel vouched for */
export function requireLinkMachine(
  request: Request
): { ok: true; machine: MachineRow } | { ok: false; response: Response } {
  if (!isProof(request.headers.get(LINK_PROOF_HEADER))) {
    return { ok: false, response: refused() };
  }
  // Re-read: it may have been removed since the request went up
  const id = request.headers.get(LINK_MACHINE_HEADER) ?? "";
  const machine = /^m_[0-9a-f]{12}$/.test(id) ? machineById(id) : null;
  if (machine?.status !== "approved") {
    return { ok: false, response: refused() };
  }
  return { ok: true, machine };
}
