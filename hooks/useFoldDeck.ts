"use client";

import { useEffect, useState, type RefObject } from "react";
import { useSnapshot } from "valtio";
import { postureStore } from "@/stores/posture";

/** Each side of the fold must leave at least this much to be worth splitting */
const MIN_SCREEN = 160;
const MIN_DECK = 96;

export interface FoldDeck {
  /** Gap to leave empty where the fold crosses the element */
  gap: number;
  /** Height below the fold: the deck, for input */
  deck: number;
}

/**
 * Half open like a laptop (fold across the screen): how an element splits
 * into the screen above the fold and the deck below it. `null` when there is
 * no horizontal fold through the element, or a side would be too small
 * (e.g. the keyboard covers the deck).
 */
export function useFoldDeck(
  ref: RefObject<HTMLElement | null>,
  /** Pixels at the element's bottom that something else covers (a keyboard inset) */
  coveredBottom = 0,
  enabled = true
): FoldDeck | null {
  const { fold } = useSnapshot(postureStore);
  const [deck, setDeck] = useState<FoldDeck | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || fold?.axis !== "horizontal") {
      setDeck(null);
      return;
    }
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const bottom = rect.bottom - coveredBottom;
      const screen = fold.start - rect.top;
      const below = bottom - fold.end;
      const next =
        screen >= MIN_SCREEN && below >= MIN_DECK
          ? { gap: Math.round(fold.end - fold.start), deck: Math.round(below) }
          : null;
      setDeck((prev) =>
        prev?.gap === next?.gap && prev?.deck === next?.deck ? prev : next
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref, fold, coveredBottom, enabled]);

  return deck;
}
