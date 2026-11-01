// Button registry, preferences, and persistence for the customizable mobile toolbar

import { useCallback, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { proxy } from "valtio";
import { toast } from "sonner";
import {
  preferencesKeys,
  usePreference,
  useUpdatePreference,
} from "@/data/preferences";
import { FOLD_CLEAR } from "@/hooks/useHinge";

export type ToolbarButtonId =
  // tools
  | "mic"
  | "paste"
  | "select"
  | "image"
  | "snippets"
  // editing
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
  | "shift-tab"
  | "ctrl-d"
  | "ctrl-r"
  // nav
  | "arrow-left"
  | "arrow-right"
  | "arrow-up"
  | "arrow-down"
  // shell
  | "char-tilde"
  | "char-slash"
  | "char-pipe"
  | "char-gt"
  | "char-at";

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
  SHIFT_TAB: "\x1b[Z",
  CTRL_C: "\x03",
  CTRL_D: "\x04",
  CTRL_Z: "\x1a",
  CTRL_L: "\x0c",
  CTRL_R: "\x12",
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
  { id: "enter", label: "Enter (hold: new line)", group: "editing", renderType: "custom", displayLabel: "\u21B5" },
  { id: "esc", label: "Escape", group: "editing", renderType: "simple-key", key: SPECIAL_KEYS.ESC, displayLabel: "Esc" },
  { id: "newline", label: "Newline", group: "editing", renderType: "simple-key", key: "\n", displayLabel: "\u21E7\u21B5" },
  { id: "cursor", label: "Cursor / Space", group: "editing", renderType: "custom", displayLabel: "\u2423" },
  { id: "backspace", label: "Backspace", group: "editing", renderType: "custom", displayLabel: "\u232B" },
  // control
  { id: "ctrl-c", label: "Ctrl+C", group: "control", renderType: "simple-key", key: SPECIAL_KEYS.CTRL_C, displayLabel: "^C", highlight: true },
  { id: "ctrl-l", label: "Ctrl+L", group: "control", renderType: "simple-key", key: SPECIAL_KEYS.CTRL_L, displayLabel: "^L" },
  { id: "ctrl-z", label: "Ctrl+Z", group: "control", renderType: "simple-key", key: SPECIAL_KEYS.CTRL_Z, displayLabel: "^Z" },
  { id: "tab", label: "Tab", group: "control", renderType: "simple-key", key: SPECIAL_KEYS.TAB, displayLabel: "Tab" },
  { id: "shift-tab", label: "Shift+Tab", group: "control", renderType: "simple-key", key: SPECIAL_KEYS.SHIFT_TAB, displayLabel: "\u21E7Tab" },
  { id: "ctrl-d", label: "Ctrl+D", group: "control", renderType: "simple-key", key: SPECIAL_KEYS.CTRL_D, displayLabel: "^D" },
  { id: "ctrl-r", label: "Ctrl+R (history search)", group: "control", renderType: "simple-key", key: SPECIAL_KEYS.CTRL_R, displayLabel: "^R" },
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
  { id: "char-at", label: "At @", group: "shell", renderType: "simple-char", key: "@", displayLabel: "@" },
];

const BUTTON_MAP = new Map(TOOLBAR_BUTTONS.map((b) => [b.id, b]));

export function getButtonDef(id: ToolbarButtonId): ToolbarButtonDef | undefined {
  return BUTTON_MAP.get(id);
}

// --- Preferences ---

export interface ToolbarPreferences {
  /** context: one row that follows what you're in; custom: row1/row2 as set */
  mode?: "context" | "custom";
  layout: "single" | "double";
  row1: ToolbarButtonId[];
  row2: ToolbarButtonId[];
  hidden: ToolbarButtonId[];
  /** Context rows reordered in Settings → Keys; a missing one is the default */
  contextRows?: Partial<Record<KeysRowId, ToolbarButtonId[]>>;
  /** ^C stays last on the context rows, after ⋯ (on unless turned off) */
  pinCtrlC?: boolean;
  /** How the open Duo lays out the composer and keys (Split unless set) */
  duoLayout?: DuoLayout;
  /** Narrow screens (the closed Duo, phones) show the adaptive row: keys
      that follow what Claude is doing, every key in its ⋯. Off: the rows
      above. On unless turned off */
  adaptive?: boolean;
}

/** The context rows Settings → Keys edits: Claude, Claude while typing, Shell */
export type KeysRowId = "claude" | "claudeUp" | "shell" | "chat";

/** Open Duo, a pane across both pages: composer left and keys right (split),
    the other way round (mirrored), or both rows across both pages */
export type DuoLayout = "split" | "mirrored" | "two-rows";

const PREFERENCES_DB_KEY = "toolbar-preferences";

// Every key, in the order the Standard preset shows them (the tools first):
// also the adaptive row's All keys
export const DEFAULT_ROW1: ToolbarButtonId[] = [
  "mic", "paste", "select", "image", "snippets",
  "enter", "esc", "newline", "cursor", "backspace",
  "ctrl-c", "ctrl-l", "ctrl-z", "tab", "shift-tab", "ctrl-d", "ctrl-r",
  "arrow-left", "arrow-right", "arrow-up", "arrow-down",
  "char-tilde", "char-slash", "char-pipe", "char-gt", "char-at",
];

// Direction D's context rows: one row, chosen by what you're in
export type KeysContext = "claude" | "shell";

// Every row starts with the tools: Copy (select), Paste, Photo and File
const TOOLS: ToolbarButtonId[] = ["select", "paste", "image", "snippets"];

const CLAUDE_DOWN: ToolbarButtonId[] = [
  ...TOOLS,
  "esc", "shift-tab", "tab",
  "arrow-left", "arrow-up", "arrow-down", "arrow-right",
  "cursor", "enter", "ctrl-c",
];
const CLAUDE_UP: ToolbarButtonId[] = [
  ...TOOLS,
  "esc", "shift-tab", "tab", "char-slash", "char-at",
  "arrow-left", "arrow-up", "arrow-down", "arrow-right",
  "newline", "ctrl-c",
];
const SHELL: ToolbarButtonId[] = [
  ...TOOLS,
  "tab", "ctrl-r",
  "arrow-left", "arrow-up", "arrow-down", "arrow-right",
  "char-slash", "cursor", "enter", "ctrl-c",
];

// The chat's row: above its reply box, and the app's bar above the keyboard
const CHAT: ToolbarButtonId[] = [
  "image", "paste", "char-slash", "char-at", "shift-tab", "esc", "newline",
];

/** The keys the chat can use: text for the box, or Shift+Tab and Esc for Claude */
export const CHAT_POOL: ToolbarButtonId[] = [
  "image", "paste", "char-slash", "char-at", "char-tilde", "char-pipe",
  "char-gt", "shift-tab", "esc", "newline",
];

export const DEFAULT_CONTEXT_ROWS: Record<KeysRowId, ToolbarButtonId[]> = {
  claude: CLAUDE_DOWN,
  claudeUp: CLAUDE_UP,
  shell: SHELL,
  chat: CHAT,
};

/** Which saved row a context shows (with the on-screen keyboard up, Claude
    Code swaps space and return for what typing a prompt needs) */
export function rowIdFor(context: KeysContext, keyboardUp: boolean): KeysRowId {
  if (context === "shell") return "shell";
  return keyboardUp ? "claudeUp" : "claude";
}

/** ^C moved last when pinned; the same array when it already is, so rows
    stay stable for memos */
export function pinnedRow(
  row: ToolbarButtonId[],
  pinCtrlC: boolean
): ToolbarButtonId[] {
  const at = row.indexOf("ctrl-c");
  if (!pinCtrlC || at < 0 || at === row.length - 1) return row;
  return [...row.filter((id) => id !== "ctrl-c"), "ctrl-c"];
}

/** A context row as saved (or the default), ^C pinned last unless that's off */
export function savedContextRow(
  rowId: KeysRowId,
  prefs?: ToolbarPreferences
): ToolbarButtonId[] {
  const row = prefs?.contextRows?.[rowId] ?? DEFAULT_CONTEXT_ROWS[rowId];
  return pinnedRow(row, prefs?.pinCtrlC ?? true);
}

/** The keys for a context row, as the user ordered them in Settings → Keys */
export function contextRow(
  context: KeysContext,
  keyboardUp: boolean,
  prefs?: ToolbarPreferences
): ToolbarButtonId[] {
  return savedContextRow(rowIdFor(context, keyboardUp), prefs);
}

/** The chat's row as ordered in Settings → Keys (only keys it can use) */
export function chatRow(prefs?: ToolbarPreferences): ToolbarButtonId[] {
  return savedContextRow("chat", prefs).filter((id) => CHAT_POOL.includes(id));
}

// --- Overflow: keys past the row's width go into ⋯ ---

/** Closed Duo: the outer display's width */
export const CLOSED_ROW_PX = 466;
/** Open Duo, split: one page less the hinge's clear band and the system
    column (an estimate for Settings' divider; the row measures itself) */
export const OPEN_DUO_ROW_PX = Math.floor(951 / 2) - FOLD_CLEAR - 36;

const KEY_MIN_PX = 40;
const KEY_GAP_PX = 4;
const ROW_PADDING_PX = 16;
/** The ⋯ key */
export const MORE_KEY_PX = KEY_MIN_PX;

/** A key at full size: 40px, wider for a label like ⇧Tab */
export function keyWidthPx(id: ToolbarButtonId): number {
  const def = getButtonDef(id);
  if (!def || def.renderType === "custom") return KEY_MIN_PX;
  return Math.max(KEY_MIN_PX, 20 + 8 * [...def.displayLabel].length);
}

/**
 * Splits a row at a width into the keys shown and those that go into ⋯
 * (in order). A pinned ^C stays shown, last, after ⋯; `reserve` is room
 * taken by anything else on the row (a gear)
 */
export function splitOverflow(
  row: ToolbarButtonId[],
  width: number,
  {
    pinCtrlC = true,
    reserve = 0,
  }: { pinCtrlC?: boolean; reserve?: number } = {}
): [ToolbarButtonId[], ToolbarButtonId[]] {
  const pinned = pinCtrlC && row.includes("ctrl-c");
  const keys = pinned ? row.filter((id) => id !== "ctrl-c") : row;
  const tail: ToolbarButtonId[] = pinned ? ["ctrl-c"] : [];
  const room = width - ROW_PADDING_PX - reserve;
  const fits = (widths: number[]) =>
    widths.reduce((sum, w) => sum + w + KEY_GAP_PX, -KEY_GAP_PX) <= room;
  const widths = keys.map(keyWidthPx);
  const tailWidths = tail.map(keyWidthPx);
  if (fits([...widths, ...tailWidths])) return [[...keys, ...tail], []];
  let n = keys.length;
  while (n > 0 && !fits([...widths.slice(0, n), MORE_KEY_PX, ...tailWidths]))
    n--;
  return [[...keys.slice(0, n), ...tail], keys.slice(n)];
}

function contextPreferences(): ToolbarPreferences {
  return {
    mode: "context",
    layout: "single",
    row1: [...CLAUDE_DOWN],
    row2: [],
    hidden: DEFAULT_ROW1.filter((id) => !CLAUDE_DOWN.includes(id)),
  };
}

export const DEFAULT_PREFERENCES: ToolbarPreferences = contextPreferences();

// What earlier versions saved as the default and the Intent preset: users
// who never customised beyond those move to the context rows
const OLD_DEFAULT_ROW1 = [
  "mic", "paste", "select", "image", "snippets",
  "shift", "enter", "esc", "newline", "cursor", "backspace",
  "ctrl-c", "ctrl-l", "ctrl-z", "tab", "ctrl-d",
  "arrow-left", "arrow-right", "arrow-up", "arrow-down",
  "char-tilde", "char-slash", "char-pipe", "char-gt",
];
const OLD_INTENT_ROW1 = [
  "esc", "tab", "ctrl-c",
  "arrow-left", "arrow-up", "arrow-down", "arrow-right",
  "newline", "paste", "image", "snippets",
];

function isOldPreset(prefs: ToolbarPreferences): boolean {
  if (prefs.mode || prefs.layout !== "single" || prefs.row2.length > 0)
    return false;
  const row1 = prefs.row1.join();
  const hidden = new Set<string>(prefs.hidden);
  const hiddenIs = (ids: string[]) =>
    hidden.size === ids.length && ids.every((id) => hidden.has(id));
  if (row1 === OLD_DEFAULT_ROW1.join()) return hiddenIs([]);
  if (row1 === OLD_INTENT_ROW1.join())
    return hiddenIs(
      OLD_DEFAULT_ROW1.filter((id) => !OLD_INTENT_ROW1.includes(id))
    );
  return false;
}

// Ensure preferences contain all known buttons (handles new buttons added in future versions)
function migratePreferences(stored: ToolbarPreferences): ToolbarPreferences {
  if (isOldPreset(stored)) return contextPreferences();
  const prefs: ToolbarPreferences = { ...stored, mode: stored.mode ?? "custom" };
  const allIds = new Set<ToolbarButtonId>(TOOLBAR_BUTTONS.map((b) => b.id));
  const present = new Set<ToolbarButtonId>([...prefs.row1, ...prefs.row2, ...prefs.hidden]);

  // Add any new buttons that don't exist in preferences yet: shown, unless
  // the user has picked their keys by hiding some
  const missing = TOOLBAR_BUTTONS.filter((b) => !present.has(b.id)).map((b) => b.id);
  if (missing.length > 0) {
    if (prefs.hidden.length > 0) prefs.hidden = [...prefs.hidden, ...missing];
    else prefs.row1 = [...prefs.row1, ...missing];
  }

  // Remove any buttons that no longer exist in the registry
  const filterValid = (ids: ToolbarButtonId[]) => ids.filter((id) => allIds.has(id));
  prefs.row1 = filterValid(prefs.row1);
  prefs.row2 = filterValid(prefs.row2);
  prefs.hidden = filterValid(prefs.hidden);
  if (prefs.contextRows) {
    const rows: Partial<Record<KeysRowId, ToolbarButtonId[]>> = {};
    for (const [rowId, ids] of Object.entries(prefs.contextRows))
      if (rowId in DEFAULT_CONTEXT_ROWS && Array.isArray(ids))
        rows[rowId as KeysRowId] = Array.from(new Set(filterValid(ids)));
    prefs.contextRows = rows;
  }

  return prefs;
}

// Another device may have changed the keys: look again when this one comes
// back, at most once a second however many rows are mounted
let lastRefresh = 0;

/**
 * Hook to load and persist toolbar preferences via the database.
 * Returns DEFAULT_PREFERENCES instantly while the DB fetch is in-flight.
 * Every caller reads the same query, so a change shows everywhere at once.
 */
export function useToolbarPreferences() {
  const { data: dbPrefs, isLoading } = usePreference<ToolbarPreferences>(
    PREFERENCES_DB_KEY,
    DEFAULT_PREFERENCES
  );
  const queryClient = useQueryClient();
  const { mutate } = useUpdatePreference();

  const preferences = useMemo(
    () => (dbPrefs ? migratePreferences(dbPrefs) : DEFAULT_PREFERENCES),
    [dbPrefs]
  );

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      // Never over a save still on its way
      if (queryClient.isMutating() > 0) return;
      if (Date.now() - lastRefresh < 1000) return;
      lastRefresh = Date.now();
      queryClient.invalidateQueries({
        queryKey: preferencesKeys.detail(PREFERENCES_DB_KEY),
      });
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [queryClient]);

  /** Shown everywhere at once but not saved (a key mid-drag) */
  const previewPreferences = useCallback(
    (next: ToolbarPreferences) => {
      queryClient.setQueryData(
        preferencesKeys.detail(PREFERENCES_DB_KEY),
        next
      );
    },
    [queryClient]
  );

  // Shown at once, before the save's optimistic update a tick later, so a
  // second quick change builds on the first. That update's own rollback
  // would only restore this preview, so a failed save puts back what was
  // there before and asks the server again
  const updatePreferences = useCallback(
    (next: ToolbarPreferences) => {
      const key = preferencesKeys.detail(PREFERENCES_DB_KEY);
      const previous = queryClient.getQueryData(key);
      previewPreferences(next);
      mutate(
        { key: PREFERENCES_DB_KEY, value: next },
        {
          onError: () => {
            queryClient.setQueryData(key, previous);
            queryClient.invalidateQueries({ queryKey: key });
            toast.error("Couldn't save that change");
          },
        }
      );
    },
    [queryClient, previewPreferences, mutate]
  );

  return { preferences, updatePreferences, previewPreferences, isLoading };
}

/** The open Duo's layout for the composer and keys (Split by default) */
export function useDuoLayout(): DuoLayout {
  return useToolbarPreferences().preferences.duoLayout ?? "split";
}

/** Settings → Keys is open. On the open Duo it covers the right page, so a
    split row shows its keys on the left page meanwhile, beside the list.
    rowWidth: what that row last measured (0 until a Duo page shows one),
    so Settings' preview and ⋯ divider cut where the row beside them does */
export const keysSettingsStore = proxy({ open: false, rowWidth: 0 });

// --- Presets ---

// Intent keys from the Duo redesign: what Claude Code needs, nothing else
const INTENT_ROW1: ToolbarButtonId[] = [
  "esc", "tab", "ctrl-c",
  "arrow-left", "arrow-up", "arrow-down", "arrow-right",
  "newline", "paste", "image", "snippets",
];

export const PRESETS = {
  context: {
    label: "Context (D)",
    description: "One row that follows what you're in",
    get: contextPreferences,
  },
  intent: {
    label: "Intent",
    description: "Esc, Tab, ^C, arrows and tools",
    get: (): ToolbarPreferences => ({
      mode: "custom",
      layout: "single",
      row1: [...INTENT_ROW1],
      row2: [],
      hidden: DEFAULT_ROW1.filter((id) => !INTENT_ROW1.includes(id)),
    }),
  },
  minimal: {
    label: "Minimal",
    description: "Essential buttons only",
    get: (): ToolbarPreferences => ({
      mode: "custom",
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
    get: (): ToolbarPreferences => ({
      mode: "custom",
      layout: "single",
      row1: [...DEFAULT_ROW1],
      row2: [],
      hidden: [],
    }),
  },
  full: {
    label: "Full",
    description: "Two rows, all buttons",
    get: (): ToolbarPreferences => ({
      mode: "custom",
      layout: "double",
      row1: [
        "mic", "paste", "select", "image", "snippets",
        "enter", "esc", "newline", "cursor", "backspace",
        "ctrl-c", "ctrl-l", "ctrl-z", "tab", "shift-tab", "ctrl-d", "ctrl-r",
      ],
      row2: [
        "arrow-left", "arrow-right", "arrow-up", "arrow-down",
        "char-tilde", "char-slash", "char-pipe", "char-gt", "char-at",
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
