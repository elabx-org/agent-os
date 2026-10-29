/**
 * Theme configuration for AgentOS. The look is a mode (light, dark, system)
 * and an accent (lib/look.ts); next-themes stores only the mode.
 *
 * The variant names are the pre-redesign themes': a stored `dark-<variant>`
 * / `light-<variant>` is read through legacyThemeToLook (lib/look.ts).
 */

export type DarkThemeVariant =
  | "deep"
  | "charcoal"
  | "warm"
  | "cool"
  | "gray"
  | "midnight"
  | "forest"
  | "purple"
  | "ocean"
  | "mocha"
  | "graphite";
export type LightThemeVariant =
  | "default"
  | "warm"
  | "cool"
  | "soft"
  | "rose"
  | "lavender"
  | "mint"
  | "peach";
export type Theme =
  | "light"
  | `light-${LightThemeVariant}`
  | "dark"
  | `dark-${DarkThemeVariant}`
  | "system";

/** The values next-themes stores now */
export const THEMES = ["light", "dark", "system"] as const;
