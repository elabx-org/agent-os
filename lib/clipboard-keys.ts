/**
 * What a copy or paste key does in the terminal. On a Mac ⌘C and ⌘V copy
 * and paste, and Ctrl keys stay with the terminal. Elsewhere it's Windows
 * Terminal's way: Ctrl+V pastes, Ctrl+C copies while something is
 * selected (in xterm, or just dragged in tmux, which keeps it in its
 * buffer) and is the interrupt otherwise; Ctrl+Shift+C and V always copy
 * and paste
 */
export type ClipboardKey = "copy" | "copyTmux" | "paste" | null;

export interface ClipboardKeyInput {
  key: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  mac: boolean;
  /** xterm has a selection (a Shift-drag, or select all) */
  selected: boolean;
  /** A drag in tmux just ended: its selection went to tmux's buffer */
  dragged: boolean;
}

export function clipboardKey(i: ClipboardKeyInput): ClipboardKey {
  if (i.alt) return null;
  const key = i.key.toLowerCase();
  if (key !== "c" && key !== "v") return null;
  const command = i.mac ? i.meta : i.ctrl && !i.meta;
  // Ctrl+Shift+C / V everywhere (Linux terminals), ⌘ or plain Ctrl by OS
  const shifted = i.ctrl && i.shift && !i.meta;
  if (!command && !shifted) return null;
  if (key === "v") return "paste";
  if (i.selected) return "copy";
  if (i.dragged || i.mac || shifted) return "copyTmux";
  // Plain Ctrl+C with nothing selected: the interrupt
  return null;
}

/** Copy and paste keys are ⌘ ones here */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(
    navigator.platform || navigator.userAgent || ""
  );
}
