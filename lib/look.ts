/**
 * The look: light/dark/system × one accent × the text size. Stored per
 * device (next-themes' `theme` key for the mode, ACCENT_STORAGE_KEY for the
 * accent, lib/display-density for the size) and, when synced, in the
 * `look` preference so every device follows it (hooks/useSyncedLook.ts).
 */

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
  orange: { label: "Orange", hex: "#EA580C" },
  green: { label: "Green", hex: "#059669" },
  graphite: { label: "Graphite", hex: "#8E8E93" },
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

/**
 * A stored next-themes value from before the redesign (`dark-graphite`,
 * `light-lavender`, `system`...) as a mode and an accent
 */
export function legacyThemeToLook(theme: string | null | undefined): {
  mode: LookMode;
  accent: Accent;
} {
  // Contract stub: U1.1 maps every legacy variant
  void theme;
  return { mode: DEFAULT_LOOK.mode, accent: DEFAULT_LOOK.accent };
}

/** A stored `look` preference with anything unknown taken from the defaults */
export function parseLook(value: unknown): Look {
  // Contract stub: U1.1 validates each field
  void value;
  return { ...DEFAULT_LOOK };
}

/** Sets html[data-accent] and remembers it on this device */
export function applyAccent(accent: Accent): void {
  // Contract stub: U1.1
  void accent;
}

/** This device's accent, from localStorage or the legacy theme */
export function readAccent(): Accent {
  // Contract stub: U1.1
  return DEFAULT_LOOK.accent;
}
