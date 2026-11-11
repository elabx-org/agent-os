"use client";

import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openLink, registerWrappedLinks } from "./wrapped-links";
import { registerPathLinks } from "./path-links";
import { loadLinkProxy } from "@/lib/client/link-target";
import { SearchAddon } from "@xterm/addon-search";
import { CanvasAddon } from "@xterm/addon-canvas";
import { getTerminalThemeForApp } from "../constants";
import { getDensity } from "@/lib/display-density";
import { terminalFontFamily, terminalFontStore } from "@/lib/terminal-font";
import { terminalFontReady } from "../font-ready";
import { applyTypingAssist, getTypingAssist } from "../typing-assist";
import { clipboardKey, isMacPlatform } from "@/lib/clipboard-keys";

export interface TerminalCallbacks {
  /** Called when paste is requested (⌘V, Ctrl+V off a Mac, Ctrl+Shift+V) */
  onPaste?: () => void;
  /** Called when copy is requested but no xterm selection exists (try tmux buffer) */
  onCopyFallback?: () => void;
}

export interface TerminalInstance {
  term: XTerm;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  cleanup: () => void;
}

export function createTerminal(
  container: HTMLElement,
  isMobile: boolean,
  theme: string,
  callbacks?: TerminalCallbacks
): TerminalInstance {
  const { terminalFontSize: fontSize, terminalLineHeight } = getDensity();
  const terminalTheme = getTerminalThemeForApp(theme || "dark");

  const term = new XTerm({
    cursorBlink: true,
    fontSize,
    fontFamily: terminalFontFamily(terminalFontStore.font),
    fontWeight: "400",
    fontWeightBold: "600",
    letterSpacing: 0,
    lineHeight: terminalLineHeight,
    scrollback: 15000,
    scrollSensitivity: isMobile ? 3 : 3,
    fastScrollSensitivity: 10,
    smoothScrollDuration: 0,
    cursorStyle: "bar",
    cursorWidth: 2,
    allowProposedApi: true,
    theme: terminalTheme,
    // FitAddon keeps the ruler's width free for a scrollbar (14px unless set);
    // on touch the scrollbar overlays the text, so give the columns back
    ...(window.matchMedia("(pointer: coarse)").matches && {
      overviewRuler: { width: 1 },
    }),
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();

  term.loadAddon(fitAddon);
  // First, so a wrapped URL beats WebLinksAddon's half of it
  registerWrappedLinks(term);
  registerPathLinks(term);
  void loadLinkProxy();
  term.loadAddon(new WebLinksAddon((_event, uri) => openLink(uri)));
  term.loadAddon(searchAddon);
  term.open(container);
  term.loadAddon(new CanvasAddon());
  paintPadding(term);
  fitAddon.fit();

  // Configure autocorrect/predictions for on-screen keyboards (user setting)
  // Xterm creates a hidden textarea for keyboard input
  setTimeout(() => {
    const textarea = container.querySelector("textarea");
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (textarea && (isMobile || touch)) {
      applyTypingAssist(textarea, getTypingAssist());
    }
  }, 100);

  // Helper to copy text to clipboard with fallback
  const copyToClipboard = (text: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        // Fallback if clipboard API fails
        execCommandCopy(text);
      });
    } else {
      // Fallback for non-secure contexts
      execCommandCopy(text);
    }
  };

  const execCommandCopy = (text: string) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  };

  // A drag in tmux (mouse mode) leaves no selection in xterm: it went to
  // tmux's buffer. Until the next key or click, Ctrl+C copies that
  const mac = isMacPlatform();
  let dragged = false;
  let downAt: { x: number; y: number } | null = null;
  const handleDragStart = (event: MouseEvent) => {
    dragged = false;
    downAt = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
  };
  const handleDragEnd = (event: MouseEvent) => {
    if (
      downAt &&
      Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 4
    )
      dragged = true;
    downAt = null;
  };
  container.addEventListener("mousedown", handleDragStart, true);
  window.addEventListener("mouseup", handleDragEnd, true);

  // Handle Cmd+A, Cmd+C, Cmd+V via document event listener (more reliable than attachCustomKeyEventHandler)
  // Only those: ⌘1–4, ⌘., ⌘K, ⌘I, ⌘N and ⌘, pass through to the app's
  // shortcuts (hooks/useViewShortcuts.ts), and xterm sends nothing for ⌘
  // keys on a Mac. Plain Ctrl keys, Esc included, stay with tmux
  const handleKeyDown = (event: KeyboardEvent) => {
    // Only handle when terminal is focused (xterm creates its textarea inside the container)
    if (!container.contains(document.activeElement)) return;

    const key = event.key.toLowerCase();
    const isMeta = event.metaKey; // Cmd on macOS
    const isCtrl = event.ctrlKey;

    // Cmd+A (macOS) / Ctrl+A for select all
    if ((isMeta || isCtrl) && key === "a") {
      event.preventDefault();
      event.stopPropagation();
      term.selectAll();
      return;
    }

    const action = clipboardKey({
      key,
      ctrl: isCtrl,
      meta: isMeta,
      shift: event.shiftKey,
      alt: event.altKey,
      mac,
      selected: term.hasSelection(),
      dragged,
    });
    // Ctrl or Shift alone comes first: the drag still counts for the C
    if (!["control", "shift", "meta", "alt"].includes(key)) dragged = false;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === "paste") {
      callbacks?.onPaste?.();
    } else if (action === "copy") {
      copyToClipboard(term.getSelection());
      term.clearSelection();
    } else {
      // No xterm selection: what was dragged in tmux is in its buffer
      callbacks?.onCopyFallback?.();
    }
  };

  // Use capture phase to intercept before browser default
  document.addEventListener("keydown", handleKeyDown, true);

  // Right-click = paste (like PuTTY/Windows Terminal)
  // Shift+right-click = show context menu (handled by Radix ContextMenu in index.tsx)
  const handleContextMenu = (event: MouseEvent) => {
    if (event.shiftKey) {
      // Shift+right-click: let the event bubble up to Radix ContextMenu
      return;
    }
    // Normal right-click: paste from clipboard
    event.preventDefault();
    event.stopPropagation();
    callbacks?.onPaste?.();
  };
  container.addEventListener("contextmenu", handleContextMenu, true);

  // Block right-click mousedown from reaching xterm/tmux (prevents tmux context menu)
  // But let Shift+right-click through for Radix context menu
  const handleMouseDown = (event: MouseEvent) => {
    if (event.button === 2 && !event.shiftKey) {
      event.stopPropagation();
    }
  };
  container.addEventListener("mousedown", handleMouseDown, true);

  const cleanup = () => {
    document.removeEventListener("keydown", handleKeyDown, true);
    container.removeEventListener("contextmenu", handleContextMenu, true);
    container.removeEventListener("mousedown", handleMouseDown, true);
    container.removeEventListener("mousedown", handleDragStart, true);
    window.removeEventListener("mouseup", handleDragEnd, true);
  };

  return { term, fitAddon, searchAddon, cleanup };
}

/** Match the font to the current display's density (see lib/display-density) */
export function updateTerminalDensity(
  term: XTerm,
  fitAddon: FitAddon,
  sendResize: (cols: number, rows: number) => void
): void {
  const { terminalFontSize: newFontSize, terminalLineHeight: newLineHeight } =
    getDensity();

  // Hidden terminals refit when shown; fitting now would shrink tmux
  if (term.options.fontSize !== newFontSize && term.element?.offsetParent) {
    term.options.fontSize = newFontSize;
    term.options.lineHeight = newLineHeight;
    term.refresh(0, term.rows - 1);
    fitAddon.fit();
    sendResize(term.cols, term.rows);
  }
}

/** Switch to the chosen font (Settings → Display) once it has loaded */
export function updateTerminalFont(
  term: XTerm,
  fitAddon: FitAddon,
  sendResize: (cols: number, rows: number) => void
): void {
  const family = terminalFontFamily(terminalFontStore.font);
  if (term.options.fontFamily === family) return;
  void terminalFontReady().then(() => {
    term.options.fontFamily = family;
    term.refresh(0, term.rows - 1);
    // Hidden terminals refit when shown; fitting now would shrink tmux
    if (!term.element?.offsetParent) return;
    fitAddon.fit();
    sendResize(term.cols, term.rows);
  });
}

export function updateTerminalTheme(term: XTerm, theme: string): void {
  const terminalTheme = getTerminalThemeForApp(theme || "dark");
  term.options.theme = terminalTheme;
  paintPadding(term);
}

/** The element's padding (the iOS app's left margin) in the terminal's own colour */
function paintPadding(term: XTerm) {
  if (term.element)
    term.element.style.backgroundColor = term.options.theme?.background ?? "";
}
