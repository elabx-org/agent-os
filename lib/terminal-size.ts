/**
 * Whether a terminal may tell tmux its size. tmux sizes a window to the
 * client that resized it last, so a terminal in a hidden tab (still at an
 * old or squeezed size) shrank the session for everyone: a few columns of
 * text and the rest dots. Only one on screen, at a usable size, resizes
 */
export const MIN_TERMINAL_COLS = 20;
export const MIN_TERMINAL_ROWS = 2;

export function canSendTerminalSize(
  el: Pick<HTMLElement, "offsetParent" | "clientWidth"> | null | undefined,
  cols: number,
  rows: number
): boolean {
  if (!el || el.offsetParent === null || el.clientWidth <= 0) return false;
  return cols >= MIN_TERMINAL_COLS && rows >= MIN_TERMINAL_ROWS;
}
