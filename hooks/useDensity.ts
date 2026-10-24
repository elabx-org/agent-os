"use client";

import { useCallback, useEffect, useState } from "react";
import {
  applyDensity,
  getDisplayClass,
  getOffset,
  setOffset,
  MAX_OFFSET,
  MIN_OFFSET,
  type DisplayClass,
} from "@/lib/display-density";

/**
 * Keeps the root size matched to the current display (re-applied when the
 * display class changes, e.g. unfolding the iPhone Duo) and exposes the
 * per-display text size adjustment.
 */
export function useDensity() {
  const [cls, setCls] = useState<DisplayClass>("desktop");
  const [offset, setOffsetState] = useState(0);

  useEffect(() => {
    let current: DisplayClass | null = null;
    const sync = () => {
      const next = getDisplayClass();
      if (next === current) return;
      current = next;
      setCls(next);
      setOffsetState(getOffset(next));
      applyDensity();
    };
    sync();
    const coarse = window.matchMedia("(pointer: coarse)");
    window.addEventListener("resize", sync);
    coarse.addEventListener("change", sync);
    return () => {
      window.removeEventListener("resize", sync);
      coarse.removeEventListener("change", sync);
    };
  }, []);

  const change = useCallback(
    (delta: number) => {
      const next = Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, offset + delta));
      setOffset(cls, next);
      setOffsetState(next);
    },
    [cls, offset]
  );

  return {
    displayClass: cls,
    offset,
    smaller: () => change(-1),
    larger: () => change(1),
    canShrink: offset > MIN_OFFSET,
    canGrow: offset < MAX_OFFSET,
  };
}
