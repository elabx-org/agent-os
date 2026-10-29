"use client";

import { useEffect } from "react";
import { runNav, type NavAction } from "@/lib/nav-actions";
import { mobileNavStore } from "@/stores/mobileNav";
import { closeSettings } from "@/stores/settingsPage";

const VIEWS: Record<string, NavAction> = {
  "1": "chat",
  "2": "terminal",
  "3": "git",
  "4": "files",
};

const KEYS: Record<string, NavAction> = {
  ".": "focus",
  k: "search",
  i: "inbox",
  n: "new",
  ",": "settings",
};

// These work while typing: switching away or finding is what you'd want
const IN_TEXT: NavAction[] = [
  "chat",
  "terminal",
  "git",
  "files",
  "focus",
  "search",
];

export function isMacLike(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/** The key for an action, e.g. "2" or "K" */
export function shortcutKey(action: NavAction): string | null {
  const key = Object.entries({ ...VIEWS, ...KEYS }).find(
    ([, a]) => a === action
  )?.[0];
  return key ? key.toUpperCase() : null;
}

/** The hint the control column shows on hover, e.g. "⌘2" or "Ctrl+2" */
export function shortcutHint(action: NavAction): string | null {
  const key = shortcutKey(action);
  if (!key) return null;
  return isMacLike() ? `⌘${key}` : `Ctrl+${key}`;
}

function fromTerminal(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(".xterm");
}

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // xterm's hidden textarea is the terminal, not a text field
  if (target.closest(".xterm")) return false;
  return (
    target.isContentEditable ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    (target.tagName === "INPUT" &&
      !["checkbox", "radio", "button", "submit", "range"].includes(
        (target as HTMLInputElement).type
      ))
  );
}

function actionFor(e: KeyboardEvent, mac: boolean): NavAction | null {
  if (e.shiftKey) return null;
  // Alt+N is New where the browser keeps ⌘N; in the terminal it's the
  // shell's M-n, so it stays there
  if (e.altKey) {
    return !e.metaKey &&
      !e.ctrlKey &&
      e.code === "KeyN" &&
      !fromTerminal(e.target)
      ? "new"
      : null;
  }
  // Ctrl on a Mac is the terminal's (^K, ^R, ...); elsewhere Ctrl is the
  // only modifier, so it's claimed only outside xterm
  if (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return null;
  if (!mac && fromTerminal(e.target)) return null;
  const key = e.key.toLowerCase();
  return VIEWS[key] ?? KEYS[key] ?? null;
}

/**
 * The web's keyboard shortcuts: ⌘1–4 Chat, Terminal, Changes, Files; ⌘.
 * Focus; ⌘K Find; ⌘I Needs you; ⌘N (or Alt+N) New; ⌘, Settings. Plain
 * Ctrl keys (^C, ^R, ^D, ^Z, ^L) and Esc always reach the terminal.
 */
export function useViewShortcuts() {
  useEffect(() => {
    const mac = isMacLike();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const action = actionFor(e, mac);
      if (!action) return;
      if (isTextInput(e.target) && !IN_TEXT.includes(action)) return;
      e.preventDefault();
      // The current view again leaves it be (the column's tap opens the
      // session list, which a shortcut shouldn't)
      if (
        (action === "chat" || action === "terminal") &&
        mobileNavStore.viewMode === action
      ) {
        closeSettings();
        return;
      }
      runNav(action);
    };
    // Capture, so a focused editor or xterm can't swallow ⌘ keys first
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
