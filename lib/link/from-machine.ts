/**
 * Who asked, when a session on a linked machine reached this server's API
 * through the link (lib/link/up.ts). The hub sets the header itself on
 * every such call. It only ever restricts the caller, so it needs no
 * proof: a local caller who adds it only limits itself.
 */

export const FROM_MACHINE_HEADER = "x-agentos-from-machine";
/** How many times sessions have started each other across machines */
export const CHAIN_HEADER = "x-agentos-chain";

/** "hub" or the machine's id; null for a caller on this server */
export function fromMachine(request: Request): string | null {
  const value = request.headers.get(FROM_MACHINE_HEADER);
  return value && /^(hub|m_[0-9a-f]{12})$/.test(value) ? value : null;
}
