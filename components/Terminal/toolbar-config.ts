// Button registry, preferences, and persistence for the customizable mobile toolbar

import { useState, useCallback, useEffect } from "react";
import { usePreference, useUpdatePreference } from "@/data/preferences";

export type ToolbarButtonId =
  // tools
  | "mic"
  | "paste"
  | "select"
  | "image"
  | "snippets"
  // editing
  | "shift"
  | "enter"
  | "esc"
  | "newline"
  | "cursor"
  | "backspace"
  // control
  | "ctrl-c"
  | "ctrl-l"
  | "ctrl-z"
  | "tab"
  | "ctrl-d"
  // nav
  | "arrow-left"
  | "arrow-right"
  | "arrow-up"
  | "arrow-down"
  // shell
  | "char-tilde"
  | "char-slash"
  | "char-pipe"
  | "char-gt";

export type ToolbarButtonGroup = "tools" | "editing" | "control" | "nav" | "shell";

export type ToolbarRenderType = "simple-key" | "simple-char" | "custom";

export interface ToolbarButtonDef {
  id: ToolbarButtonId;
  label: string; // Human-readable for settings UI
  group: ToolbarButtonGroup;
  renderType: ToolbarRenderType;
  key?: string; // ANSI key code (for simple-key/simple-char)
  displayLabel: string; // What shows on the button
  highlight?: boolean;
  conditional?: "mic" | "image" | "select-mode";
}

// ANSI escape sequences
const SPECIAL_KEYS = {
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  LEFT: "\x1b[D",
  RIGHT: "\x1b[C",
  ESC: "\x1b",
  TAB: "\t",
  CTRL_C: "\x03",
  CTRL_D: "\x04",
  CTRL_Z: "\x1a",
  CTRL_L: "\x0c",
} as const;

export { SPECIAL_KEYS };

export const TOOLBAR_BUTTONS: ToolbarButtonDef[] = [
  // tools
  { id: "mic", label: "Microphone", group: "tools", renderType: "custom", displayLabel: "", conditional: "mic" },
  { id: "paste", label: "Paste", group: "tools", renderType: "custom", displayLabel: "" },
  { id: "select", label: "Select Mode", group: "tools", renderType: "custom", displayLabel: "", conditional: "select-mode" },
  { id: "image", label: "Image Picker", group: "tools", renderType: "custom", displayLabel: "", conditional: "image" },
  { id: "snippets", label: "Snippets", group: "tools", renderType: "custom", displayLabel: "" },
  // editing
  { id: "shift", label: "Shift", group: "editing", renderType: "custom", displayLabel: "\u21E7" },
  { id: "enter", label: "Enter", group: "editing", renderType: "custom", displayLabel: "\u21B5" },
  { id: "esc", label: "Escape", group: "editing", renderType: "simple-key", key: SPECIAL_KEYS.ESC, displayLabel: "Esc" },
  { id: "newline", label: "Newline", group: "editing", renderType: "simple-key", key: "\n", displayLabel: "\u21E7\u21B5" },
  { id: "cursor", label: "Cursor / Space", group: "editing", renderType: "custom", displayLabel: "\u2395" },
  { id: "backspace", label: "Backspace", group: "editing", renderType: "custom", displayLabel: "\u232B" },
  // control
  { id: "ctrl-c", label: "Ctrl+C", group: "control", renderType: "simple-key", key: SPECIAL_KEYS.CTRL_C, displayLabel: "^C", highlight: true },
  { id: "ctrl-l", label: "Ctrl+L", group: "control", renderType: "simple-key", key: SPECIAL_KEYS.CTRL_L, displayLabel: "^L" },
  { id: "ctrl-z", label: "Ctrl+Z", group: "control", renderType: "simple-key", key: SPECIAL_KEYS.CTRL_Z, displayLabel: "^Z" },
  { id: "tab", label: "Tab", group: "control", renderType: "simple-key", key: SPECIAL_KEYS.TAB, displayLabel: "Tab" },
  { id: "ctrl-d", label: "Ctrl+D", group: "control", renderType: "simple-key", key: SPECIAL_KEYS.CTRL_D, displayLabel: "^D" },
  // nav
  { id: "arrow-left", label: "Left Arrow", group: "nav", renderType: "simple-key", key: SPECIAL_KEYS.LEFT, displayLabel: "\u2190" },
  { id: "arrow-right", label: "Right Arrow", group: "nav", renderType: "simple-key", key: SPECIAL_KEYS.RIGHT, displayLabel: "\u2192" },
  { id: "arrow-up", label: "Up Arrow", group: "nav", renderType: "simple-key", key: SPECIAL_KEYS.UP, displayLabel: "\u2191" },
  { id: "arrow-down", label: "Down Arrow", group: "nav", renderType: "simple-key", key: SPECIAL_KEYS.DOWN, displayLabel: "\u2193" },
  // shell
  { id: "char-tilde", label: "Tilde ~", group: "shell", renderType: "simple-char", key: "~", displayLabel: "~" },
  { id: "char-slash", label: "Slash /", group: "shell", renderType: "simple-char", key: "/", displayLabel: "/" },
  { id: "char-pipe", label: "Pipe |", group: "shell", renderType: "simple-char", key: "|", displayLabel: "|" },
  { id: "char-gt", label: "Greater >", group: "shell", renderType: "simple-char", key: ">", displayLabel: ">" },
];

const BUTTON_MAP = new Map(TOOLBAR_BUTTONS.map((b) => [b.id, b]));

export function getButtonDef(id: ToolbarButtonId): ToolbarButtonDef | undefined {
  return BUTTON_MAP.get(id);
}

// --- Preferences ---

export interface ToolbarPreferences {
  layout: "single" | "double";
  row1: ToolbarButtonId[];
  row2: ToolbarButtonId[];
  hidden: ToolbarButtonId[];
}

const PREFERENCES_DB_KEY = "toolbar-preferences";

// Default order matches current hardcoded toolbar exactly
const DEFAULT_ROW1: ToolbarButtonId[] = [
  "mic", "paste", "select", "image", "snippets",
  "shift", "enter", "esc", "newline", "cursor", "backspace",
  "ctrl-c", "ctrl-l", "ctrl-z", "tab", "ctrl-d",
  "arrow-left", "arrow-right", "arrow-up", "arrow-down",
  "char-tilde", "char-slash", "char-pipe", "char-gt",
];

export const DEFAULT_PREFERENCES: ToolbarPreferences = {
  layout: "single",
  row1: [...DEFAULT_ROW1],
  row2: [],
  hidden: [],
};

// Ensure preferences contain all known buttons (handles new buttons added in future versions)
function migratePreferences(prefs: ToolbarPreferences): ToolbarPreferences {
  const allIds = new Set<ToolbarButtonId>(TOOLBAR_BUTTONS.map((b) => b.id));
  const present = new Set<ToolbarButtonId>([...prefs.row1, ...prefs.row2, ...prefs.hidden]);

  // Add any new buttons that don't exist in preferences yet
  const missing = TOOLBAR_BUTTONS.filter((b) => !present.has(b.id)).map((b) => b.id);
  if (missing.length > 0) {
    prefs.row1 = [...prefs.row1, ...missing];
  }

  // Remove any buttons that no longer exist in the registry
  const filterValid = (ids: ToolbarButtonId[]) => ids.filter((id) => allIds.has(id));
  prefs.row1 = filterValid(prefs.row1);
  prefs.row2 = filterValid(prefs.row2);
  prefs.hidden = filterValid(prefs.hidden);

  return prefs;
}

/**
 * Hook to load and persist toolbar preferences via the database.
 * Returns DEFAULT_PREFERENCES instantly while the DB fetch is in-flight.
 */
export function useToolbarPreferences() {
  const { data: dbPrefs, isLoading } = usePreference<ToolbarPreferences>(
    PREFERENCES_DB_KEY,
    DEFAULT_PREFERENCES
  );
  const updateMutation = useUpdatePreference();

  // Local state for instant UI feedback — initialized from defaults,
  // then synced once DB data arrives
  const [preferences, setPreferences] = useState<ToolbarPreferences>(DEFAULT_PREFERENCES);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!isLoading && dbPrefs && !synced) {
      setPreferences(migratePreferences(dbPrefs));
      setSynced(true);
    }
  }, [dbPrefs, isLoading, synced]);

  const updatePreferences = useCallback(
    (next: ToolbarPreferences) => {
      setPreferences(next);
      updateMutation.mutate({ key: PREFERENCES_DB_KEY, value: next });
    },
    [updateMutation]
  );

  return { preferences, updatePreferences, isLoading: isLoading && !synced };
}

// --- Presets ---

export const PRESETS = {
  minimal: {
    label: "Minimal",
    description: "Essential buttons only",
    get: (): ToolbarPreferences => ({
      layout: "single",
      row1: ["paste", "enter", "backspace", "ctrl-c", "arrow-left", "arrow-right", "arrow-up", "arrow-down"],
      row2: [],
      hidden: DEFAULT_ROW1.filter(
        (id) => !["paste", "enter", "backspace", "ctrl-c", "arrow-left", "arrow-right", "arrow-up", "arrow-down"].includes(id)
      ),
    }),
  },
  standard: {
    label: "Standard",
    description: "All buttons, single row",
    get: (): ToolbarPreferences => ({ ...DEFAULT_PREFERENCES, row1: [...DEFAULT_ROW1] }),
  },
  full: {
    label: "Full",
    description: "Two rows, all buttons",
    get: (): ToolbarPreferences => ({
      layout: "double",
      row1: [
        "mic", "paste", "select", "image", "snippets",
        "shift", "enter", "esc", "newline", "cursor", "backspace",
        "ctrl-c", "ctrl-l", "ctrl-z", "tab", "ctrl-d",
      ],
      row2: [
        "arrow-left", "arrow-right", "arrow-up", "arrow-down",
        "char-tilde", "char-slash", "char-pipe", "char-gt",
      ],
      hidden: [],
    }),
  },
} as const;

export type PresetId = keyof typeof PRESETS;

// --- Group labels for settings UI ---

export const GROUP_LABELS: Record<ToolbarButtonGroup, string> = {
  tools: "Tools",
  editing: "Editing",
  control: "Control",
  nav: "Navigation",
  shell: "Shell Characters",
};
