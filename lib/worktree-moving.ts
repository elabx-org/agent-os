/**
 * Sessions being moved into a worktree right now (M5). While one is,
 * readiness() holds it ("moving"), so neither the queue dispatcher nor a
 * direct send starts a turn the move would cut short. On globalThis: a move
 * runs in Next's copy of the modules (POST) or server.ts's (a scheduled one,
 * from the dispatcher), and both must agree.
 */

const shared = globalThis as unknown as { __agentosMoving?: Set<string> };

function set(): Set<string> {
  return (shared.__agentosMoving ??= new Set());
}

export function markMoving(sessionId: string): void {
  set().add(sessionId);
}

export function clearMoving(sessionId: string): void {
  set().delete(sessionId);
}

export function isMoving(sessionId: string): boolean {
  return set().has(sessionId);
}
