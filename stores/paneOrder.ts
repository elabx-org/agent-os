import { proxy } from "valtio";

/**
 * Which side each of two panes shows on (Open-Beside's swap). Swapping
 * changes only where they're placed (CSS order), never the React tree, so
 * no terminal remounts or attaches again. M1b U1b.4 wires it into
 * PaneLayout and the swap handler.
 */
export const paneOrderStore = proxy<{ swapped: boolean }>({ swapped: false });

export function toggleSwap(): void {
  paneOrderStore.swapped = !paneOrderStore.swapped;
}
