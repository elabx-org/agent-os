import { proxy } from "valtio";

/**
 * The terminal's typeface (Settings → Display), saved on the server so every
 * device draws the same; its size stays per display (lib/display-density).
 * Both are loaded by next/font in app/layout.tsx under their own names.
 */
export type TerminalFont = "jetbrains" | "plex";

export const TERMINAL_FONTS: Record<
  TerminalFont,
  { name: string; note: string }
> = {
  jetbrains: { name: "JetBrains Mono", note: "Clear, made for code" },
  plex: { name: "IBM Plex Mono", note: "Softer and rounder" },
};

export const DEFAULT_TERMINAL_FONT: TerminalFont = "jetbrains";
export const TERMINAL_FONT_KEY = "terminal-font";
/** This device's copy, so a terminal opens in the font before the server answers */
const STORAGE_KEY = "agentos:terminal-font";

export function readTerminalFont(value: unknown): TerminalFont {
  return value === "plex" || value === "jetbrains"
    ? value
    : DEFAULT_TERMINAL_FONT;
}

/** xterm's fontFamily: the choice, then the other, then the system's */
export function terminalFontFamily(font: TerminalFont): string {
  const other = font === "plex" ? "jetbrains" : "plex";
  return `"${TERMINAL_FONTS[font].name}", "${TERMINAL_FONTS[other].name}", Menlo, Monaco, "Courier New", monospace`;
}

/** What the terminal waits for before it measures its cells */
export function terminalFontSpec(font: TerminalFont): string {
  return `13px "${TERMINAL_FONTS[font].name}"`;
}

function stored(): TerminalFont {
  try {
    return readTerminalFont(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_TERMINAL_FONT;
  }
}

export const terminalFontStore = proxy<{ font: TerminalFont }>({
  font: typeof window === "undefined" ? DEFAULT_TERMINAL_FONT : stored(),
});

export function setTerminalFont(font: TerminalFont): void {
  terminalFontStore.font = font;
  try {
    localStorage.setItem(STORAGE_KEY, font);
  } catch {
    // Storage blocked: the server's copy still loads on the next visit
  }
}
