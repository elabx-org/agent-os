/**
 * Sessions being handed off right now (M4). While one is, readiness()
 * holds it, so neither the queue dispatcher nor a direct send starts a
 * turn the handoff would then cut short. On globalThis: the handoff runs
 * in Next's copy of the modules, the dispatcher in server.ts's.
 */

const shared = globalThis as unknown as { __agentosHandingOff?: Set<string> };

function set(): Set<string> {
  return (shared.__agentosHandingOff ??= new Set());
}

export function markHandingOff(sessionId: string): void {
  set().add(sessionId);
}

export function clearHandingOff(sessionId: string): void {
  set().delete(sessionId);
}

export function isHandingOff(sessionId: string): boolean {
  return set().has(sessionId);
}
