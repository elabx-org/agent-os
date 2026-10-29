/**
 * M3: a script's keyboard shortcut as stored in `.agent-os.json`
 * ("Cmd+Shift+T"), matched against key events and shown as ⌘⇧T. Cmd means
 * Ctrl off the Mac, as useViewShortcuts does. Pure, client and server.
 *
 * Contract stubs: U3.2 implements.
 */

export interface ShortcutSpec {
  /** Cmd on a Mac, Ctrl elsewhere */
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** Upper-case letter or digit, e.g. "T" */
  key: string;
}

/** null for anything that isn't Cmd/Ctrl/Shift/Alt + one letter or digit */
export function parseShortcut(_text: string | undefined): ShortcutSpec | null {
  return null;
}

/** "Cmd+Shift+T" */
export function shortcutText(_spec: ShortcutSpec): string {
  return "";
}

/** ⌘⇧T on a Mac, Ctrl+Shift+T elsewhere */
export function formatShortcut(_spec: ShortcutSpec, _mac: boolean): string {
  return "";
}

/** The shortcut a key press records in the Add script dialog, if it is one */
export function shortcutFromEvent(
  _e: Pick<
    KeyboardEvent,
    "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
  >,
  _mac: boolean
): ShortcutSpec | null {
  return null;
}

export function matchesShortcut(
  _e: Pick<
    KeyboardEvent,
    "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
  >,
  _spec: ShortcutSpec,
  _mac: boolean
): boolean {
  return false;
}

/** Taken by the app (useViewShortcuts' ⌘1–4 . K I N ,), so a script can't have it */
export function isReservedShortcut(_spec: ShortcutSpec): boolean {
  return false;
}
