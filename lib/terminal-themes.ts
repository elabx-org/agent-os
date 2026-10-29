/**
 * Terminal theme definitions for xterm.js
 * One palette per mode; the accent doesn't reach the terminal
 */

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

// The mock's terminal (ui.css .term): true black, soft white text, the
// state colours for green/red/yellow and violet for the cursor and selection
const DARK_TERMINAL: TerminalTheme = {
  background: "#000000",
  foreground: "#E5E5EA",
  cursor: "#A78BFA",
  cursorAccent: "#000000",
  selectionBackground: "#7C3AED59",
  black: "#1C1C20",
  red: "#F87171",
  green: "#34D399",
  yellow: "#FBBF24",
  blue: "#93B4F5",
  magenta: "#C4B5FD",
  cyan: "#7DD3C0",
  white: "#E5E5EA",
  brightBlack: "#8E8E93",
  brightRed: "#FCA5A5",
  brightGreen: "#6EE7B7",
  brightYellow: "#FCD34D",
  brightBlue: "#BFD3FA",
  brightMagenta: "#DDD6FE",
  brightCyan: "#A7F3E4",
  brightWhite: "#FFFFFF",
};

// On the light page: the same hues, deep enough to read on #F2F2F7
const LIGHT_TERMINAL: TerminalTheme = {
  background: "#F2F2F7",
  foreground: "#1C1C1F",
  cursor: "#7C3AED",
  cursorAccent: "#F2F2F7",
  selectionBackground: "#7C3AED33",
  black: "#1C1C1F",
  red: "#DC2626",
  green: "#047857",
  yellow: "#B45309",
  blue: "#2563EB",
  magenta: "#7C3AED",
  cyan: "#0E7490",
  white: "#D1D1D6",
  brightBlack: "#6B6B70",
  brightRed: "#EF4444",
  brightGreen: "#059669",
  brightYellow: "#D97706",
  brightBlue: "#3B82F6",
  brightMagenta: "#8B5CF6",
  brightCyan: "#0891B2",
  brightWhite: "#FFFFFF",
};

/**
 * Get terminal theme for a given app theme string
 * @param theme - "dark", "light" or "system" (dark); a pre-redesign
 * "dark-purple" or "light-warm" counts as its mode
 */
export function getTerminalTheme(theme: string): TerminalTheme {
  return { ...(theme.startsWith("light") ? LIGHT_TERMINAL : DARK_TERMINAL) };
}
