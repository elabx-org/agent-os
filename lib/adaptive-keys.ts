/**
 * The adaptive key row (narrow screens: the closed iPhone Duo, phones): one
 * row whose keys follow what the session is doing, each with a second key
 * a flick up away. Every other key is in its ⋯ (All keys). Above the
 * composer the row leads with the tools (Photo, Paste or Copy, File).
 *
 * Ids are the toolbar's (components/Terminal/toolbar-config.ts), plus
 * digit-N for a prompt's options, so the app's keyboard bar can show the
 * same row (ios/App/KeyboardBar.swift has the same flicks).
 */

export type AdaptiveState = "working" | "asks" | "idle" | "shell";

export interface Flick {
  label: string;
  /** Sent apart, in order (two Escs in one chunk read as Alt+Esc) */
  keys: string[];
}

export interface AdaptiveKey {
  id: string;
  label: string;
  key: string;
  flick?: Flick;
  /** Held, it repeats */
  repeats?: boolean;
  danger?: boolean;
}

const ESC = "\x1b";

const FLICKS: Record<string, Flick> = {
  esc: { label: "^C", keys: ["\x03"] },
  tab: { label: "⇧Tab", keys: ["\x1b[Z"] },
  "shift-tab": { label: "Tab", keys: ["\t"] },
  enter: { label: "⇧↵", keys: ["\n"] },
  "ctrl-c": { label: "^D", keys: ["\x04"] },
  "char-slash": { label: "@", keys: ["@"] },
  "ctrl-r": { label: "^L", keys: ["\x0c"] },
  "arrow-up": { label: "PgUp", keys: ["\x1b[5~"] },
  "arrow-down": { label: "PgDn", keys: ["\x1b[6~"] },
  "arrow-left": { label: "Home", keys: ["\x1b[H"] },
  "arrow-right": { label: "End", keys: ["\x1b[F"] },
};

const KEYS: Record<string, Omit<AdaptiveKey, "id" | "flick">> = {
  esc: { label: "Esc", key: ESC },
  tab: { label: "Tab", key: "\t" },
  "shift-tab": { label: "⇧Tab", key: "\x1b[Z" },
  enter: { label: "↵", key: "\r" },
  "ctrl-c": { label: "^C", key: "\x03", danger: true },
  "ctrl-r": { label: "^R", key: "\x12" },
  "char-slash": { label: "/", key: "/" },
  "arrow-up": { label: "↑", key: "\x1b[A", repeats: true },
  "arrow-down": { label: "↓", key: "\x1b[B", repeats: true },
  "arrow-left": { label: "←", key: "\x1b[D", repeats: true },
  "arrow-right": { label: "→", key: "\x1b[C", repeats: true },
};

function key(id: string, extra?: Partial<AdaptiveKey>): AdaptiveKey {
  if (id.startsWith("digit-")) {
    const n = id.slice(6);
    return { id, label: n, key: n, ...extra };
  }
  return { id, ...KEYS[id], flick: FLICKS[id], ...extra };
}

/** Most options a prompt gets number keys for (five keys fit beside the
    tools on the closed Duo: past three the row narrows its keys) */
const MAX_DIGITS = 4;

/** The row's key ids for a state; `options`: the prompt's, when it asks */
export function adaptiveIds(state: AdaptiveState, options = 0): string[] {
  switch (state) {
    case "asks": {
      const digits = Array.from(
        { length: Math.min(options, MAX_DIGITS) },
        (_, i) => `digit-${i + 1}`
      );
      return [...digits, "esc", "enter"];
    }
    case "shell":
      return ["tab", "arrow-up", "arrow-down", "enter", "ctrl-c"];
    // Working keeps the idle row, so nothing moves when Claude starts. No ↵:
    // Send with an empty box presses Enter
    default:
      return ["char-slash", "shift-tab", "arrow-up", "arrow-down", "esc"];
  }
}

/** The row for a state */
export function adaptiveRow(state: AdaptiveState, options = 0): AdaptiveKey[] {
  return adaptiveIds(state, options).map((id) => key(id));
}

/**
 * The app's keyboard bar (0.1.47 on): its row for a state, as the bar's
 * `id/flick/hold` specs (flick: a key id, empty for none; hold: "repeat",
 * "menu" or empty). Tools lead; ⋯ sits where it's placed. Laid out in the
 * keyboard bar builder.
 */
export function barSpecs(state: AdaptiveState, options = 0): string[] {
  const tools = ["paste", "snippets", "image"];
  switch (state) {
    case "asks": {
      const digits = Array.from(
        { length: Math.min(options, MAX_DIGITS) },
        (_, i) => `digit-${i + 1}`
      );
      return [...tools, ...digits, "esc/ctrl-c/", "enter/newline/", "more"];
    }
    case "shell":
      return [
        ...tools,
        "tab/shift-tab/",
        "arrow-up/page-up/repeat",
        "arrow-down/page-down/repeat",
        "enter/newline/",
        "ctrl-c/ctrl-d/menu",
        "more",
      ];
    default:
      return [
        ...tools,
        "char-slash/char-at/",
        "shift-tab/tab/",
        "arrow-up/page-up/repeat",
        "arrow-down/page-down/repeat",
        "arrow-left//repeat",
        "arrow-right//repeat",
        "esc/ctrl-c/",
        "enter//",
        "newline//",
        "more",
        "ctrl-c//",
        "ctrl-d//",
        "ctrl-r//",
        "ctrl-l//",
        "ctrl-z//",
        "page-up",
        "page-down",
        "home",
        "end",
        "esc-esc",
        "char-tilde",
        "char-pipe",
      ];
  }
}
