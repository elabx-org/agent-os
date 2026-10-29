/**
 * Theme configuration for AgentOS. The look is a mode (light, dark, system)
 * and an accent (lib/look.ts); next-themes stores only the mode.
 *
 * The variant lists below are the pre-redesign themes, kept so a stored
 * `dark-<variant>` / `light-<variant>` still parses and the Display section
 * keeps compiling until it offers mode × accent. Every variant now draws the
 * same palette for its mode, with the accent legacyThemeToLook gives it.
 */

import {
  Moon,
  Sun,
  Monitor,
  Flame,
  Zap,
  CloudMoon,
  Trees,
  Sparkles,
  Waves,
  Coffee,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { ACCENT_LABELS, legacyThemeToLook, type LookMode } from "./look";

export type ThemeMode = LookMode;
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

export interface ThemeOption {
  id: DarkThemeVariant | LightThemeVariant;
  label: string;
  description: string;
  icon: LucideIcon;
  preview: {
    background: string;
    foreground: string;
    accent: string;
  };
}

// The page and text of each mode (styles/themes.css), the variant's accent
function option(
  mode: "dark" | "light",
  id: DarkThemeVariant | LightThemeVariant,
  label: string,
  icon: LucideIcon
): ThemeOption {
  const { accent } = legacyThemeToLook(`${mode}-${id}`);
  return {
    id,
    label,
    description: `${ACCENT_LABELS[accent].label} accent`,
    icon,
    preview:
      mode === "dark"
        ? {
            background: "#000000",
            foreground: "#F5F5F7",
            accent: ACCENT_LABELS[accent].hex,
          }
        : {
            background: "#F2F2F7",
            foreground: "#111114",
            accent: ACCENT_LABELS[accent].hex,
          },
  };
}

/** @deprecated The look is mode × accent (lib/look.ts) */
export const DARK_THEMES: ThemeOption[] = [
  option("dark", "deep", "Deep Black", Moon),
  option("dark", "charcoal", "Charcoal", Moon),
  option("dark", "warm", "Warm", Flame),
  option("dark", "cool", "Cool", Zap),
  option("dark", "gray", "Gray", Monitor),
  option("dark", "midnight", "Midnight", CloudMoon),
  option("dark", "forest", "Forest", Trees),
  option("dark", "purple", "Purple", Sparkles),
  option("dark", "ocean", "Ocean", Waves),
  option("dark", "mocha", "Mocha", Coffee),
  option("dark", "graphite", "Graphite", Layers),
];

/** @deprecated The look is mode × accent (lib/look.ts) */
export const LIGHT_THEMES: ThemeOption[] = [
  option("light", "default", "Default", Sun),
  option("light", "warm", "Warm", Flame),
  option("light", "cool", "Cool", Zap),
  option("light", "soft", "Soft", CloudMoon),
  option("light", "rose", "Rose", Sparkles),
  option("light", "lavender", "Lavender", Sparkles),
  option("light", "mint", "Mint", Trees),
  option("light", "peach", "Peach", Sun),
];

/**
 * A stored theme's mode, and its old variant if it names a known one
 * ("dark" is deep, "light" default). Accepts every value ever stored;
 * anything else is dark.
 */
export function parseTheme(theme: string | null | undefined): {
  mode: ThemeMode;
  variant: DarkThemeVariant | LightThemeVariant | null;
} {
  const { mode } = legacyThemeToLook(theme);
  if (mode === "system") return { mode, variant: null };
  const name = (theme ?? "").slice(mode.length + 1);
  const list = mode === "dark" ? DARK_THEMES : LIGHT_THEMES;
  const known = theme?.startsWith(`${mode}-`)
    ? list.find((t) => t.id === name)
    : undefined;
  return {
    mode,
    variant: known ? known.id : mode === "dark" ? "deep" : "default",
  };
}

/**
 * Build a theme string from mode and variant
 * @deprecated Store the mode alone; the accent is separate (lib/look.ts)
 */
export function buildTheme(
  mode: ThemeMode,
  variant: DarkThemeVariant | LightThemeVariant | null
): Theme {
  if (mode === "system") return "system";
  if (!variant || variant === "default" || variant === "deep") return mode;
  return `${mode}-${variant}` as Theme;
}

/** All theme strings for next-themes */
export function getAllThemes(): Theme[] {
  return [...THEMES];
}
