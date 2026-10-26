"use client";

import { useEffect, useState } from "react";
import { useSnapshot } from "valtio";
import { postureStore } from "@/stores/posture";
import { MIN_DECK, MIN_SCREEN } from "@/hooks/useFoldDeck";

export interface Tabletop {
  /** Height above the fold, from the viewport's top */
  top: number;
  /** The fold itself, to leave empty */
  gap: number;
  /** Height below the fold: the base, for controls */
  base: number;
}

/**
 * Half folded on a table (or like a laptop): how the whole viewport splits
 * around the fold. The page-level twin of useFoldDeck, for layers that cover
 * the viewport. `null` without a horizontal fold, or when a side would be too
 * small (e.g. the keyboard covers the base).
 */
export function useTabletop(
  /** Pixels at the viewport's bottom that something else covers (a keyboard inset) */
  coveredBottom = 0,
  enabled = true
): Tabletop | null {
  const { fold } = useSnapshot(postureStore);
  const [tabletop, setTabletop] = useState<Tabletop | null>(null);

  useEffect(() => {
    if (!enabled || fold?.axis !== "horizontal") {
      setTabletop(null);
      return;
    }
    const measure = () => {
      const base = Math.round(window.innerHeight - coveredBottom - fold.end);
      const next =
        fold.start >= MIN_SCREEN && base >= MIN_DECK
          ? {
              top: Math.round(fold.start),
              gap: Math.round(fold.end - fold.start),
              base,
            }
          : null;
      setTabletop((prev) =>
        prev?.top === next?.top &&
        prev?.gap === next?.gap &&
        prev?.base === next?.base
          ? prev
          : next
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fold, coveredBottom, enabled]);

  return tabletop;
}
