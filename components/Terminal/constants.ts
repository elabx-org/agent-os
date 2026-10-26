/**
 * Terminal constants and theme configuration
 */

import { getTerminalTheme, type TerminalTheme } from "@/lib/terminal-themes";
import { currentBackgroundHex } from "@/lib/background";

// Reconnection constants
export const WS_RECONNECT_BASE_DELAY = 1000; // 1 second
export const WS_RECONNECT_MAX_DELAY = 30000; // 30 seconds

// Get terminal theme for current app theme, on this device's own
// background if one is set (Settings → Display)
export function getTerminalThemeForApp(theme: string): TerminalTheme {
  const base = getTerminalTheme(theme);
  const background = currentBackgroundHex();
  return background ? { ...base, background, cursorAccent: background } : base;
}

// Legacy exports for compatibility - default dark themes
export const TERMINAL_THEME_DARK = getTerminalTheme("dark");
export const TERMINAL_THEME_LIGHT = getTerminalTheme("light");
export const TERMINAL_THEME = TERMINAL_THEME_DARK;
