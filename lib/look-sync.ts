/**
 * Which look wins, for hooks/useSyncedLook.ts: pure, so it's unit tested.
 */

import {
  ACCENT_LABELS,
  legacyThemeToLook,
  parseLook,
  type Look,
  type LookMode,
} from "./look";

/** localStorage: "0" when this device keeps its own look */
export const LOOK_SYNCED_STORAGE_KEY = "agentos:look-synced";

const MODES: readonly LookMode[] = ["light", "dark", "system"];

/** next-themes' value as a mode; a pre-redesign value through the legacy map */
export function modeFromTheme(theme: string | null | undefined): LookMode {
  if (MODES.includes(theme as LookMode)) return theme as LookMode;
  return legacyThemeToLook(theme).mode;
}

/** Synced unless this device turned it off */
export function readSynced(stored: string | null): boolean {
  return stored !== "0" && stored !== "false";
}

/**
 * The look to apply on load. Unsynced, this device's own. Synced, the
 * server's (unknown fields from the defaults), or this device's when the
 * server has none yet (it's then saved there, so others follow it).
 */
export function mergeLook(local: Look, server: unknown, synced: boolean): Look {
  if (!synced || server === null || server === undefined) return local;
  return { ...parseLook(server), synced: true };
}

/** Whether applying `next` over `current` changes anything on screen */
export function lookDiffers(current: Look, next: Look): boolean {
  return (
    current.mode !== next.mode ||
    current.accent !== next.accent ||
    current.textSize !== next.textSize
  );
}

/** The Appearance choices as Display names them */
export const MODE_LABEL: Record<LookMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "Automatic",
};

/** "Dark · Purple", the Display row's value */
export function lookSummary(look: Pick<Look, "mode" | "accent">): string {
  return `${MODE_LABEL[look.mode]} · ${ACCENT_LABELS[look.accent].label}`;
}
