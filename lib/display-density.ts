/**
 * Per-display sizing. The iPhone Duo has a narrow outer display and a wide
 * inner one, so each display class gets its own defaults and its own user
 * adjustment, and unfolding switches between them without manual zooming.
 */

export type DisplayClass = "compact" | "tablet" | "desktop";

interface Density {
  /** Root font size in px; all rem-based UI scales with it */
  ui: number;
  terminalFontSize: number;
  terminalLineHeight: number;
}

const DEFAULTS: Record<DisplayClass, Density> = {
  // Phones and the Duo outer display
  compact: { ui: 15, terminalFontSize: 12, terminalLineHeight: 1.15 },
  // Duo inner display and tablets: touch, but wide
  tablet: { ui: 14, terminalFontSize: 12, terminalLineHeight: 1.15 },
  desktop: { ui: 16, terminalFontSize: 14, terminalLineHeight: 1.2 },
};

export const MIN_OFFSET = -3;
export const MAX_OFFSET = 4;
const STORAGE_PREFIX = "agentos:textsize:";
export const DENSITY_EVENT = "agentos:density";

export function getDisplayClass(): DisplayClass {
  if (window.innerWidth < 600) return "compact";
  if (window.matchMedia("(pointer: coarse)").matches) return "tablet";
  return "desktop";
}

export function getOffset(cls: DisplayClass): number {
  try {
    return Number(localStorage.getItem(STORAGE_PREFIX + cls)) || 0;
  } catch {
    return 0;
  }
}

export function setOffset(cls: DisplayClass, offset: number): void {
  const clamped = Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, offset));
  try {
    localStorage.setItem(STORAGE_PREFIX + cls, String(clamped));
  } catch {
    // Private mode: the size still applies for this page load
  }
  applyDensity(clamped);
}

/** The text size step as Display shows it: "Default", "+2", "−1" */
export function offsetLabel(offset: number): string {
  if (offset === 0) return "Default";
  return offset > 0 ? `+${offset}` : `−${-offset}`;
}

export function getDensity(offset?: number): Density {
  const cls = getDisplayClass();
  const base = DEFAULTS[cls];
  const step = offset ?? getOffset(cls);
  return {
    ui: base.ui + step,
    terminalFontSize: base.terminalFontSize + step,
    terminalLineHeight: base.terminalLineHeight,
  };
}

/** Size the UI for the current display and tell terminals to follow */
export function applyDensity(offset?: number): void {
  const { ui } = getDensity(offset);
  document.documentElement.style.fontSize = `${ui}px`;
  window.dispatchEvent(new Event(DENSITY_EVENT));
}

/**
 * Inline <head> script: sets the root size before first paint so the page
 * doesn't jump. Mirrors getDisplayClass/DEFAULTS.ui.
 */
export const DENSITY_BOOT_SCRIPT = `(function(){try{var w=innerWidth,c=w<600?"compact":matchMedia("(pointer: coarse)").matches?"tablet":"desktop";var b={compact:${DEFAULTS.compact.ui},tablet:${DEFAULTS.tablet.ui},desktop:${DEFAULTS.desktop.ui}}[c];var o=Number(localStorage.getItem("${STORAGE_PREFIX}"+c))||0;document.documentElement.style.fontSize=(b+o)+"px"}catch(e){}})()`;
