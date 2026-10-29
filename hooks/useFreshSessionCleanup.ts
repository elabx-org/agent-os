"use client";

/**
 * Mounted once by the page with the focused pane's session. When the user
 * moves off a fresh session (stores/bgSend.ts) that is untouched
 * (lib/bg-send.ts isUntouched), it is stopped and deleted, so repeated
 * background sends don't litter Now.
 */
export function useFreshSessionCleanup(
  _focusedSessionId: string | undefined
): void {}
