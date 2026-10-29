import { proxy } from "valtio";

// Kept per device, as the pane layout it goes with (lib/panes.ts), so a
// reload (the app reconnecting after a deploy) keeps the sides
const KEY = "agentos.panesSwapped";

/**
 * Which side each of two panes shows on (Open-Beside's swap). Swapping
 * changes only where they're placed (CSS order), never the React tree, so
 * no terminal remounts or attaches again.
 */
export const paneOrderStore = proxy<{ swapped: boolean }>({
  swapped: loadSwapped(),
});

function loadSwapped(): boolean {
  try {
    return (
      typeof window !== "undefined" && window.localStorage.getItem(KEY) === "1"
    );
  } catch {
    return false;
  }
}

function setSwapped(swapped: boolean): void {
  paneOrderStore.swapped = swapped;
  try {
    if (swapped) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private mode or blocked storage: the swap lasts until a reload
  }
}

export function toggleSwap(): void {
  setSwapped(!paneOrderStore.swapped);
}

/** Fewer than two panes: nothing to swap, so the next pair starts in order */
export function resetSwap(): void {
  if (paneOrderStore.swapped) setSwapped(false);
}

/** The panes left to right as shown: only a pair is ever swapped */
export function paneOrder<T>(ids: readonly T[], swapped: boolean): T[] {
  return swapped && ids.length === 2 ? [ids[1], ids[0]] : [...ids];
}

/**
 * A pane's CSS `order` among its siblings: 0 and 2 for the pair, leaving 1
 * for the gutter between them
 */
export function paneCssOrder<T>(
  id: T,
  ids: readonly T[],
  swapped: boolean
): number {
  return paneOrder(ids, swapped).indexOf(id) * 2;
}

/** The gutter's CSS `order`: always between the two panes */
export const GUTTER_ORDER = 1;
