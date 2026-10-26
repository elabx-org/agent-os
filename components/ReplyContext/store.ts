import { proxy, useSnapshot } from "valtio";
import { mobileNavActions } from "@/stores/mobileNav";

/**
 * The reply context's shared UI state: the turn a card was dismissed for,
 * sessions whose context shows somewhere else (the spread's left page), and
 * a "Jump to it" on its way to the chat. In memory, per session id.
 */
export const replyContextStore = proxy<{
  /** Session id → the turn whose card was put away with × */
  dismissed: Record<string, string>;
  /** Sessions whose context another layout shows, so the card stays away */
  shownElsewhere: Record<string, true>;
  /** A chat item to scroll to, taken by that session's ChatView */
  jump: { sessionId: string; itemId: string; at: number } | null;
}>({
  dismissed: {},
  shownElsewhere: {},
  jump: null,
});

/**
 * Another layout (the open Duo's spread, the tabletop's top half) shows this
 * session's context, so the card above the composer steps aside
 */
export function setContextShownElsewhere(sessionId: string, on: boolean) {
  if (on) replyContextStore.shownElsewhere[sessionId] = true;
  else delete replyContextStore.shownElsewhere[sessionId];
}

export function useContextShownElsewhere(
  sessionId: string | null | undefined
): boolean {
  const { shownElsewhere } = useSnapshot(replyContextStore);
  return !!sessionId && !!shownElsewhere[sessionId];
}

export function dismissCard(sessionId: string, turn: string) {
  replyContextStore.dismissed[sessionId] = turn;
}

/**
 * Show this chat item in the session's Chat: from Terminal the pane switches
 * to Chat first, and the ChatView scrolls once it has the item
 */
export function jumpTo(
  sessionId: string,
  itemId: string,
  { switchView = false }: { switchView?: boolean } = {}
) {
  replyContextStore.jump = { sessionId, itemId, at: Date.now() };
  if (switchView) mobileNavActions.requestViewMode("chat", sessionId);
}

export function clearJump() {
  replyContextStore.jump = null;
}
