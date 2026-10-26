"use client";

import { useEffect, useState } from "react";

/** Controls keep this far either side of the hinge while the Duo lies flat */
export const FOLD_CLEAR = 20;

/**
 * Where the open iPhone Duo's hinge crosses the screen while it lies flat:
 * no fold is reported then, so it is taken as the middle of a landscape
 * viewport (a heuristic). Sets html[data-hinge] with --hinge-x and
 * --fold-clear for the .fold-controls rule; null when not enabled or portrait.
 */
export function useHinge(enabled: boolean): number | null {
  const [hingeX, setHingeX] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setHingeX(null);
      return;
    }
    const update = () =>
      setHingeX(
        window.innerWidth > window.innerHeight ? window.innerWidth / 2 : null
      );
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [enabled]);

  useEffect(() => {
    if (hingeX === null) return;
    const root = document.documentElement;
    root.dataset.hinge = "";
    root.style.setProperty("--hinge-x", `${hingeX}px`);
    root.style.setProperty("--fold-clear", `${FOLD_CLEAR}px`);
    return () => {
      delete root.dataset.hinge;
      root.style.removeProperty("--hinge-x");
      root.style.removeProperty("--fold-clear");
    };
  }, [hingeX]);

  return hingeX;
}
