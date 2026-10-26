"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { postureStore } from "@/stores/posture";

const MARGIN = 8;

export interface PopoverPlacement {
  below: boolean;
  /** Room on the chosen side, so the panel never runs past it */
  maxHeight: number | undefined;
}

/**
 * Where something floating over the composer opens: above it, or below it
 * when it sits high on the screen (the terminal's keybar can be at the top).
 * Half open on a table, a composer on the deck opens into the deck, never
 * across the fold. `ref` is the floating element; its parent is the box.
 */
export function usePopoverPlacement(
  ref: RefObject<HTMLElement | null>,
  open: boolean
): PopoverPlacement {
  const [placement, setPlacement] = useState<PopoverPlacement>({
    below: false,
    maxHeight: undefined,
  });
  // Measured each render while open: the composer moves with the keyboard
  useLayoutEffect(() => {
    const box = ref.current?.parentElement?.getBoundingClientRect();
    if (!open || !box) return;
    // The visual viewport: iOS Safari's innerHeight ignores the keyboard
    const vv = window.visualViewport;
    const top = vv ? vv.offsetTop : 0;
    const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const fold = postureStore.fold;
    const onDeck = fold?.axis === "horizontal" && box.top >= fold.end;
    const below = onDeck || box.top - top < bottom - box.bottom;
    const room = below ? bottom - box.bottom : box.top - top;
    const maxHeight = Math.max(0, Math.round(room - MARGIN * 2));
    setPlacement((prev) =>
      prev.below === below && prev.maxHeight === maxHeight
        ? prev
        : { below, maxHeight }
    );
  });
  return placement;
}
