import { useEffect, useState } from "react";
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
  /** Sessions whose context another layout shows (how many), so the card
   * stays away */
  shownElsewhere: Record<string, number>;
  /** Sessions whose composer is in use on a touch screen, keyboard up */
  typing: Record<string, true>;
  /** A chat item to scroll to, taken by that session's ChatView */
  jump: { sessionId: string; itemId: string; at: number } | null;
}>({
  dismissed: {},
  shownElsewhere: {},
  typing: {},
  jump: null,
});

/**
 * Another layout (the open Duo's spread, the tabletop's top half) shows this
 * session's context, so the card above the composer steps aside. Counted, so
 * each layout turns off only its own (call on, then off, once each).
 */
export function setContextShownElsewhere(sessionId: string, on: boolean) {
  const n = (replyContextStore.shownElsewhere[sessionId] ?? 0) + (on ? 1 : -1);
  if (n > 0) replyContextStore.shownElsewhere[sessionId] = n;
  else delete replyContextStore.shownElsewhere[sessionId];
}

export function useContextShownElsewhere(
  sessionId: string | null | undefined
): boolean {
  const { shownElsewhere } = useSnapshot(replyContextStore);
  return !!sessionId && !!shownElsewhere[sessionId];
}

export function setTyping(sessionId: string, on: boolean) {
  if (on) replyContextStore.typing[sessionId] = true;
  else delete replyContextStore.typing[sessionId];
}

// A moment's blur (a tap moving focus, the keyboard settling) mustn't swap
// a whole layout out and back
const TYPING_OFF_MS = 250;

/**
 * This session's reply is being typed (touch, box focused, keyboard up), for
 * layouts that make room for its context: the spread, the tabletop's top half
 */
export function useReplying(sessionId: string | null | undefined): boolean {
  const { typing } = useSnapshot(replyContextStore);
  const now = !!sessionId && !!typing[sessionId];
  const [on, setOn] = useState(now);
  useEffect(() => {
    if (now) {
      setOn(true);
      return;
    }
    const timer = setTimeout(() => setOn(false), TYPING_OFF_MS);
    return () => clearTimeout(timer);
  }, [now]);
  return on;
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
