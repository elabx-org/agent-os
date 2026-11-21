/**
 * Sessions this machine must not start or copy: the hub continued them
 * from their copy (lib/backup/machine.ts pauseTaken). Added the moment the
 * hub's "taken" list arrives, before anything else is done about it. On
 * globalThis: server.ts and the Next routes are separate module graphs.
 */

const shared = globalThis as typeof globalThis & {
  __agentosBackupHeld?: Set<string>;
};

export const heldSessions = (): Set<string> =>
  (shared.__agentosBackupHeld ??= new Set());

export const isHeld = (sessionId: string): boolean =>
  heldSessions().has(sessionId);
