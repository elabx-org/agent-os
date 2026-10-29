"use client";

import { useSnapshot } from "valtio";
import { bgSendStore } from "@/stores/bgSend";

/**
 * N-BgSend's dim: while the send menu of `sessionId` is open, the pane
 * (header, transcript) darkens behind it. Mounted in the pane and again
 * inside the chat (its own stacking layer, raised over the pane's dim).
 * Above it sit the toast (z-20), the composer (z-30 while its menu is
 * open) and the menu (z-50). It never takes a tap: the menu's own
 * outside-tap puts the menu away.
 */
export function SendMenuDim({ sessionId }: { sessionId?: string | null }) {
  const { menuFor } = useSnapshot(bgSendStore);
  if (!sessionId || menuFor !== sessionId) return null;
  return (
    <div
      aria-hidden="true"
      data-send-menu-dim=""
      className="pointer-events-none absolute inset-0 z-10 bg-black/25 dark:bg-black/60"
    />
  );
}
