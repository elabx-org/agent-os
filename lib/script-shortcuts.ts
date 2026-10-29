/**
 * M3: a script's keyboard shortcut as stored in `.agent-os.json`
 * ("Cmd+Shift+T"), matched against key events and shown as ⌘⇧T. Cmd means
 * Ctrl off the Mac, as useViewShortcuts does. Pure, client and server.
 */

export interface ShortcutSpec {
  /** Cmd on a Mac, Ctrl elsewhere */
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** Upper-case letter or digit, e.g. "T" */
  key: string;
}

type KeyLike = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;

const MOD_WORDS = new Set(["cmd", "command", "meta", "mod", "ctrl", "control"]);
const SHIFT_WORDS = new Set(["shift"]);
const ALT_WORDS = new Set(["alt", "option", "opt"]);
const GLYPHS: Record<string, keyof Omit<ShortcutSpec, "key">> = {
  "⌘": "mod",
  "⌃": "mod",
  "⇧": "shift",
  "⌥": "alt",
};

const isKey = (key: string) => /^[A-Z0-9]$/.test(key);

/**
 * A shortcut needs Cmd/Ctrl or Alt: Shift alone is typing, so is a bare key
 */
function valid(spec: ShortcutSpec): ShortcutSpec | null {
  return isKey(spec.key) && (spec.mod || spec.alt) ? spec : null;
}

/** null for anything that isn't Cmd/Ctrl/Shift/Alt + one letter or digit */
export function parseShortcut(text: string | undefined): ShortcutSpec | null {
  const value = text?.trim();
  if (!value) return null;
  const spec: ShortcutSpec = { mod: false, shift: false, alt: false, key: "" };
  // "⌘⇧T" as shown, as well as "Cmd+Shift+T" as stored
  const parts = value.includes("+")
    ? value.split("+").map((p) => p.trim())
    : [...value];
  for (const [i, raw] of parts.entries()) {
    const word = raw.toLowerCase();
    const last = i === parts.length - 1;
    if (MOD_WORDS.has(word) || GLYPHS[raw] === "mod") spec.mod = true;
    else if (SHIFT_WORDS.has(word) || GLYPHS[raw] === "shift")
      spec.shift = true;
    else if (ALT_WORDS.has(word) || GLYPHS[raw] === "alt") spec.alt = true;
    else if (last) spec.key = raw.toUpperCase();
    else return null;
  }
  return valid(spec);
}

/** "Cmd+Shift+T" */
export function shortcutText(spec: ShortcutSpec): string {
  return [spec.mod && "Cmd", spec.alt && "Alt", spec.shift && "Shift", spec.key]
    .filter(Boolean)
    .join("+");
}

/** ⌘⇧T on a Mac, Ctrl+Shift+T elsewhere */
export function formatShortcut(spec: ShortcutSpec, mac: boolean): string {
  if (mac)
    return [spec.mod && "⌘", spec.alt && "⌥", spec.shift && "⇧", spec.key]
      .filter(Boolean)
      .join("");
  return [
    spec.mod && "Ctrl",
    spec.alt && "Alt",
    spec.shift && "Shift",
    spec.key,
  ]
    .filter(Boolean)
    .join("+");
}

/**
 * The letter or digit pressed, by its place on the keyboard: Shift+1 is "!"
 * and Alt+T is "†" on a Mac, but their codes stay Digit1 and KeyT
 */
function keyOf(e: KeyLike): string | null {
  const byCode = /^(?:Key([A-Z])|Digit([0-9])|Numpad([0-9]))$/.exec(
    e.code ?? ""
  );
  if (byCode) return byCode[1] ?? byCode[2] ?? byCode[3];
  const key = (e.key ?? "").toUpperCase();
  return isKey(key) ? key : null;
}

/** The shortcut a key press records in the Add script dialog, if it is one */
export function shortcutFromEvent(
  e: KeyLike,
  mac: boolean
): ShortcutSpec | null {
  // The other one is the terminal's (Ctrl on a Mac) or the system's (Win)
  if (mac ? e.ctrlKey : e.metaKey) return null;
  const key = keyOf(e);
  if (!key) return null;
  return valid({
    mod: mac ? e.metaKey : e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    key,
  });
}

export function matchesShortcut(
  e: KeyLike,
  spec: ShortcutSpec,
  mac: boolean
): boolean {
  const pressed = shortcutFromEvent(e, mac);
  return (
    !!pressed &&
    pressed.key === spec.key &&
    pressed.mod === spec.mod &&
    pressed.shift === spec.shift &&
    pressed.alt === spec.alt
  );
}

/** useViewShortcuts' ⌘ keys, without Shift or Alt */
const RESERVED_MOD = new Set(["1", "2", "3", "4", ".", "K", "I", "N", ","]);

/** Taken by the app (useViewShortcuts' ⌘1–4 . K I N , and Alt+N), so a script can't have it */
export function isReservedShortcut(spec: ShortcutSpec): boolean {
  const key = spec.key.toUpperCase();
  if (spec.mod && !spec.shift && !spec.alt) return RESERVED_MOD.has(key);
  // Alt+N is New where the browser keeps ⌘N
  return spec.alt && !spec.mod && !spec.shift && key === "N";
}
