import { proxy } from "valtio";

/**
 * Which side each of two panes shows on (Open-Beside's swap). Swapping
 * changes only where they're placed (CSS order), never the React tree, so
 * no terminal remounts or attaches again.
 */
export const paneOrderStore = proxy<{ swapped: boolean }>({ swapped: false });

export function toggleSwap(): void {
  paneOrderStore.swapped = !paneOrderStore.swapped;
}

/** Fewer than two panes: nothing to swap, so the next pair starts in order */
export function resetSwap(): void {
  if (paneOrderStore.swapped) paneOrderStore.swapped = false;
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
