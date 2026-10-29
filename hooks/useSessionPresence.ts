"use client";

/**
 * Tells the server which session this client has focused (POST
 * /api/presence every PRESENCE_BEAT_MS while the page is visible), so
 * auto-settle never settles what someone is looking at (M8)
 */
export function useSessionPresence(_focusedSessionId: string | null): void {
  // M8 U2
}
