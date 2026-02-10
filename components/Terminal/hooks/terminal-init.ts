"use client";

import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { CanvasAddon } from "@xterm/addon-canvas";
import { getTerminalThemeForApp } from "../constants";

export interface TerminalCallbacks {
  /** Called when paste is requested (Cmd+V or Ctrl+Shift+V) */
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
  const fontSize = isMobile ? 11 : 14;
  const terminalTheme = getTerminalThemeForApp(theme || "dark");

  const term = new XTerm({
    cursorBlink: true,
    fontSize,
    fontFamily:
      '"JetBrains Mono", "Fira Code", Menlo, Monaco, "Courier New", monospace',
    fontWeight: "400",
    fontWeightBold: "600",
    letterSpacing: 0,
    lineHeight: isMobile ? 1.15 : 1.2,
    scrollback: 15000,
    scrollSensitivity: isMobile ? 3 : 3,
    fastScrollSensitivity: 10,
    smoothScrollDuration: 0,
    cursorStyle: "bar",
    cursorWidth: 2,
    allowProposedApi: true,
    theme: terminalTheme,
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();

  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.loadAddon(searchAddon);
  term.open(container);
  term.loadAddon(new CanvasAddon());
  fitAddon.fit();

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

  // Handle Cmd+A, Cmd+C, Cmd+V via document event listener (more reliable than attachCustomKeyEventHandler)
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

    // Cmd+V (macOS) or Ctrl+Shift+V for paste
    if ((isMeta && key === "v") || (isCtrl && event.shiftKey && key === "v")) {
      event.preventDefault();
      event.stopPropagation();
      callbacks?.onPaste?.();
      return;
    }

    // Cmd+C (macOS) for copy — try xterm selection first, then tmux buffer fallback
    // Ctrl+Shift+C also copies (Linux convention)
    // Plain Ctrl+C without selection must pass through as SIGINT
    if (key === "c") {
      if (isMeta || (isCtrl && event.shiftKey)) {
        const selection = term.getSelection();
        if (selection) {
          event.preventDefault();
          event.stopPropagation();
          copyToClipboard(selection);
        } else {
          // No xterm selection — try tmux buffer
          event.preventDefault();
          event.stopPropagation();
          callbacks?.onCopyFallback?.();
        }
        return;
      }
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
  };

  return { term, fitAddon, searchAddon, cleanup };
}

export function updateTerminalForMobile(
  term: XTerm,
  fitAddon: FitAddon,
  isMobile: boolean,
  sendResize: (cols: number, rows: number) => void
): void {
  const newFontSize = isMobile ? 11 : 14;
  const newLineHeight = isMobile ? 1.15 : 1.2;

  if (term.options.fontSize !== newFontSize) {
    term.options.fontSize = newFontSize;
    term.options.lineHeight = newLineHeight;
    term.refresh(0, term.rows - 1);
    fitAddon.fit();
    sendResize(term.cols, term.rows);
  }
}

export function updateTerminalTheme(term: XTerm, theme: string): void {
  const terminalTheme = getTerminalThemeForApp(theme || "dark");
  term.options.theme = terminalTheme;
}
