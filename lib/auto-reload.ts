/**
 * After a deploy the open page reloads itself, but only at a moment that
 * costs the user nothing: no text typed anywhere, nothing open on top, and
 * either the app is in the background or they have left it alone a while.
 * No DOM here: the hook reads the page and asks.
 */

export interface PageMoment {
  /** The tab or app is in the background */
  hidden: boolean;
  /** Some field holds text that a reload would throw away */
  draft: boolean;
  /** A sheet, dialog or menu is open */
  overlay: boolean;
  /** The cursor is in a field or the terminal */
  typing: boolean;
  /** Since the last tap or key */
  idleMs: number;
}

/** Long enough that a reload can't land between two taps */
export const RELOAD_IDLE_MS = 5000;
/** With the cursor in an (empty) field or the terminal: a longer pause */
export const RELOAD_TYPING_IDLE_MS = 20_000;

export function canReloadNow(moment: PageMoment): boolean {
  if (moment.draft || moment.overlay) return false;
  if (moment.hidden) return true;
  return (
    moment.idleMs >= (moment.typing ? RELOAD_TYPING_IDLE_MS : RELOAD_IDLE_MS)
  );
}
