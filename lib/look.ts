/**
 * The look: light/dark/system × one accent × the text size. Stored per
 * device (next-themes' `theme` key for the mode, ACCENT_STORAGE_KEY for the
 * accent, lib/display-density for the size) and, when synced, in the
 * `look` preference so every device follows it (hooks/useSyncedLook.ts).
 */

import { MAX_OFFSET, MIN_OFFSET } from "./display-density";

export type LookMode = "light" | "dark" | "system";

export type Accent = "purple" | "blue" | "orange" | "green" | "graphite";

export interface Look {
  mode: LookMode;
  accent: Accent;
  /** The text size step for this display class (lib/display-density offset) */
  textSize: number;
  /** Follow the server's look on every device */
  synced: boolean;
}

export const LOOK_MODES: readonly LookMode[] = ["light", "dark", "system"];

export const ACCENTS: readonly Accent[] = [
  "purple",
  "blue",
  "orange",
  "green",
  "graphite",
];

/** What the Display section shows for each accent, and its swatch */
export const ACCENT_LABELS: Record<Accent, { label: string; hex: string }> = {
  purple: { label: "Purple", hex: "#7C3AED" },
  blue: { label: "Blue", hex: "#2563EB" },
  orange: { label: "Orange", hex: "#C2410C" },
  green: { label: "Green", hex: "#047857" },
  graphite: { label: "Graphite", hex: "#52525B" },
};

export const DEFAULT_LOOK: Look = {
  mode: "dark",
  accent: "purple",
  textSize: 0,
  synced: true,
};

export const LOOK_PREFERENCE_KEY = "look";
/** localStorage key for this device's accent; html[data-accent] carries it */
export const ACCENT_STORAGE_KEY = "agentos:accent";
/** next-themes' localStorage key: "light", "dark" or "system" */
export const THEME_STORAGE_KEY = "theme";

export function isLookMode(value: unknown): value is LookMode {
  return LOOK_MODES.includes(value as LookMode);
}

export function isAccent(value: unknown): value is Accent {
  return ACCENTS.includes(value as Accent);
}

/**
 * A stored next-themes value from before the redesign (`dark-graphite`,
 * `light-lavender`, `system`...) as a mode and an accent. Each old palette
 * keeps the accent nearest its own colour:
 *
 *   purple    dark-deep (and plain dark), dark-graphite, dark-purple,
 *             light-default (and plain light), light-lavender, light-rose
 *   blue      dark-cool, dark-midnight, dark-ocean, light-cool
 *   orange    dark-warm, dark-mocha, light-warm, light-peach
 *   green     dark-forest, light-mint
 *   graphite  dark-charcoal, dark-gray, light-soft
 *
 * "system" stays system; anything else (null, junk) is dark + purple, and an
 * unknown variant keeps its mode. Self-contained: LOOK_BOOT_SCRIPT inlines
 * its source, so it refers to nothing outside itself.
 */
export function legacyThemeToLook(theme: string | null | undefined): {
  mode: LookMode;
  accent: Accent;
} {
  const accents: Record<string, Accent> = {
    "dark-cool": "blue",
    "dark-midnight": "blue",
    "dark-ocean": "blue",
    "light-cool": "blue",
    "dark-warm": "orange",
    "dark-mocha": "orange",
    "light-warm": "orange",
    "light-peach": "orange",
    "dark-forest": "green",
    "light-mint": "green",
    "dark-charcoal": "graphite",
    "dark-gray": "graphite",
    "light-soft": "graphite",
  };
  const value = typeof theme === "string" ? theme : "";
  const mode = value.split("-")[0];
  if (mode !== "light" && mode !== "dark" && value !== "system") {
    return { mode: "dark", accent: "purple" };
  }
  return {
    mode: value === "system" ? "system" : (mode as "light" | "dark"),
    accent: Object.prototype.hasOwnProperty.call(accents, value)
      ? accents[value]
      : "purple",
  };
}

/** A stored `look` preference with anything unknown taken from the defaults */
export function parseLook(value: unknown): Look {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  const look = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const textSize =
    typeof look.textSize === "number" && Number.isFinite(look.textSize)
      ? Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, Math.round(look.textSize)))
      : DEFAULT_LOOK.textSize;
  return {
    mode: isLookMode(look.mode) ? look.mode : DEFAULT_LOOK.mode,
    accent: isAccent(look.accent) ? look.accent : DEFAULT_LOOK.accent,
    textSize,
    synced:
      typeof look.synced === "boolean" ? look.synced : DEFAULT_LOOK.synced,
  };
}

/** Sets html[data-accent] and remembers it on this device */
export function applyAccent(accent: Accent): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-accent", accent);
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  } catch {}
}

/** This device's accent, from localStorage or the legacy theme */
export function readAccent(): Accent {
  try {
    const saved = localStorage.getItem(ACCENT_STORAGE_KEY);
    if (isAccent(saved)) return saved;
    return legacyThemeToLook(localStorage.getItem(THEME_STORAGE_KEY)).accent;
  } catch {
    return DEFAULT_LOOK.accent;
  }
}

/**
 * Before the first paint: the mode's class and the accent on <html>. A legacy
 * `dark-<variant>` is rewritten to its mode (next-themes only knows light,
 * dark and system, and would otherwise fall back to its default) and its
 * accent saved, unless this device has one already. Self-contained like
 * legacyThemeToLook, which it is handed.
 */
function bootLook(toLook: typeof legacyThemeToLook) {
  const root = document.documentElement;
  let theme: string | null = null;
  let accent: string | null = null;
  try {
    theme = localStorage.getItem("theme");
    accent = localStorage.getItem("agentos:accent");
  } catch (e) {}
  const look = toLook(theme);
  const legacy = theme !== null && theme !== look.mode;
  const known = ["purple", "blue", "orange", "green", "graphite"];
  if (!accent || known.indexOf(accent) < 0) {
    accent = look.accent;
    if (legacy) {
      try {
        localStorage.setItem("agentos:accent", accent);
      } catch (e) {}
    }
  }
  if (legacy) {
    try {
      localStorage.setItem("theme", look.mode);
    } catch (e) {}
  }
  const dark =
    look.mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : look.mode === "dark";
  root.classList.remove("light", "dark");
  root.classList.add(dark ? "dark" : "light");
  root.removeAttribute("data-theme-variant");
  root.setAttribute("data-accent", accent);
}

/** Inlined in app/layout.tsx's <head>; dark + purple if anything throws */
export const LOOK_BOOT_SCRIPT = `try{(${bootLook.toString()})(${legacyThemeToLook.toString()})}catch(e){var r=document.documentElement;r.classList.remove("light");r.classList.add("dark");r.setAttribute("data-accent","purple")}`;
