/**
 * A background of your own over the theme's (Settings → Display), saved on
 * this device: one for dark themes and one for light. The surfaces (cards,
 * fills, borders, inputs) are worked out from it so they still match; the
 * theme's accent and text stay as they are.
 */

export const BACKGROUND_KEY = "agentos-background";
export const BACKGROUND_EVENT = "agentos-background-change";

export type BackgroundMode = "dark" | "light";

/** "default" (the theme's own), a named preset, or "#rrggbb" */
export type BackgroundChoice = string;

export interface BackgroundPreset {
  id: string;
  label: string;
  description: string;
  hex: string;
}

export const DARK_PRESETS: BackgroundPreset[] = [
  {
    id: "neutral",
    label: "Neutral",
    description: "Graphite",
    hex: "#0E1013",
  },
  {
    id: "black",
    label: "True black",
    description: "For OLED screens",
    hex: "#000000",
  },
];

export const LIGHT_PRESETS: BackgroundPreset[] = [
  {
    id: "paper",
    label: "Paper",
    description: "Warm off-white",
    hex: "#FAF8F3",
  },
];

export const DARK_SWATCHES = [
  "#101418",
  "#14110F",
  "#0F1412",
  "#120E14",
  "#0A0F1A",
];
export const LIGHT_SWATCHES = [
  "#FFFFFF",
  "#F6F7F9",
  "#F7F3EE",
  "#F2F6F3",
  "#F4F2F8",
];

type Saved = Partial<Record<BackgroundMode, BackgroundChoice>>;

function read(): Saved {
  try {
    return JSON.parse(localStorage.getItem(BACKGROUND_KEY) || "{}") as Saved;
  } catch {
    return {};
  }
}

export function getBackground(mode: BackgroundMode): BackgroundChoice {
  return read()[mode] ?? "default";
}

export function setBackground(mode: BackgroundMode, choice: BackgroundChoice) {
  const saved = read();
  if (choice === "default") delete saved[mode];
  else saved[mode] = choice;
  try {
    localStorage.setItem(BACKGROUND_KEY, JSON.stringify(saved));
  } catch {}
  applyBackground();
  window.dispatchEvent(new Event(BACKGROUND_EVENT));
}

export function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

/** The colour a choice stands for, or null for the theme's own */
export function backgroundHex(
  mode: BackgroundMode,
  choice: BackgroundChoice
): string | null {
  if (isHex(choice)) return choice;
  const presets = mode === "dark" ? DARK_PRESETS : LIGHT_PRESETS;
  return presets.find((p) => p.id === choice)?.hex ?? null;
}

/** This device's background for the mode on screen now, or null */
export function currentBackgroundHex(): string | null {
  if (typeof document === "undefined") return null;
  const mode: BackgroundMode = document.documentElement.classList.contains(
    "light"
  )
    ? "light"
    : "dark";
  return backgroundHex(mode, getBackground(mode));
}

/**
 * Sets (or clears) the surface variables on <html> for the saved background.
 * Self-contained: app/layout.tsx inlines its source to paint the first frame.
 */
export function applyBackground() {
  const VARS = [
    "background",
    "card",
    "popover",
    "secondary",
    "muted",
    "accent",
    "border",
    "input",
    "sidebar-background",
    "sidebar-accent",
    "sidebar-border",
  ];
  const root = document.documentElement;
  for (const v of VARS) root.style.removeProperty("--" + v);

  const light = root.classList.contains("light");
  let saved: Record<string, string> = {};
  try {
    saved = JSON.parse(localStorage.getItem("agentos-background") || "{}");
  } catch {}
  const presets: Record<string, string> = light
    ? { paper: "#FAF8F3" }
    : { neutral: "#0E1013", black: "#000000" };
  const choice = saved[light ? "light" : "dark"];
  const hex = choice && (presets[choice] ?? choice);
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return;

  // #rrggbb to h, s, l
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    const [r, g, b] = rgb;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const L = l * 100;
  // Surfaces keep the background's hue, a little calmer
  const S = Math.min(s * 100, 40);
  const tone = (step: number, sat = S) =>
    `${h.toFixed(1)} ${sat.toFixed(1)}% ${Math.max(0, Math.min(100, L + step)).toFixed(1)}%`;

  // Steps match the built-in themes: dark surfaces rise from the
  // background, light ones sink from it (cards stay lighter)
  const steps: Record<string, number> = light
    ? {
        card: 100 - L,
        popover: 100 - L,
        secondary: -4,
        muted: -4,
        accent: -5,
        border: -9,
        input: -9,
        "sidebar-background": -2,
        "sidebar-accent": -5,
        "sidebar-border": -9,
      }
    : {
        card: 2.5,
        popover: 4,
        secondary: 6,
        muted: 6,
        accent: 8,
        border: 10,
        input: 3,
        "sidebar-background": 4,
        "sidebar-accent": 8,
        "sidebar-border": 10,
      };
  root.style.setProperty("--background", tone(0, s * 100));
  for (const v in steps) root.style.setProperty("--" + v, tone(steps[v]));
}

/** Paints the saved background before the first frame (after the theme's class) */
export const BACKGROUND_BOOT_SCRIPT = `try{(${applyBackground.toString()})()}catch(e){}`;
