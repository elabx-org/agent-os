/**
 * Which sessions the connected clients have focused (POST /api/presence),
 * on globalThis so the Next routes and server.ts agree. Auto-settle never
 * settles a session focused anywhere.
 */

import type { PresenceRequest } from "./settle-types";

export function markPresence(_request: PresenceRequest, _now?: number): void {
  // M8 U2
}

/** Focused on a visible client heard from within PRESENCE_TTL_MS */
export function isFocusedAnywhere(_sessionId: string, _now?: number): boolean {
  return false; // M8 U2
}
