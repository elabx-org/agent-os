"use client";

import { useEffect } from "react";
import { useSnapshot } from "valtio";
import { clearJump, replyContextStore } from "./store";

// A jump not taken by then (the item never loaded) is dropped
const JUMP_TTL_MS = 10_000;
const HIGHLIGHT_MS = 1600;
// The keyboard going down and a view switching in settle within this
const SETTLE_MS = 300;

/** Brief tint on the item jumped to, in the theme's accent surface */
function highlight(el: HTMLElement) {
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim();
  if (!accent || typeof el.animate !== "function") return;
  const on = `hsl(${accent})`;
  const off = `hsl(${accent} / 0)`;
  el.animate(
    [
      { backgroundColor: on, boxShadow: `0 0 0 6px ${on}` },
      { backgroundColor: off, boxShadow: `0 0 0 6px ${off}` },
    ],
    { duration: HIGHLIGHT_MS, easing: "ease-in" }
  );
}

/**
 * Takes a "Jump to it" for this session: once `find` has the item's element
 * (the view may have just switched, the item may still be loading), scrolls
 * it into view and tints it briefly. Only while the chat is showing.
 */
export function useChatJump(
  sessionId: string,
  active: boolean,
  find: (itemId: string) => HTMLElement | null
) {
  const { jump } = useSnapshot(replyContextStore);
  useEffect(() => {
    if (!active || !jump || jump.sessionId !== sessionId) return;
    if (Date.now() - jump.at > JUMP_TTL_MS) {
      clearJump();
      return;
    }
    const el = find(jump.itemId);
    if (!el) return;
    clearJump();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Once the view has laid out (it may have only just been shown) and the
    // keyboard has gone. Not cancelled on cleanup: clearing the jump re-runs
    // this effect at once.
    setTimeout(() => {
      if (!el.isConnected) return;
      // A long message ends with what it asks: show its end
      const tall = el.offsetHeight > window.innerHeight * 0.5;
      el.scrollIntoView({
        block: tall ? "end" : "center",
        behavior: still ? "auto" : "smooth",
      });
      highlight(el);
    }, SETTLE_MS);
  }, [jump, active, sessionId, find]);
}
