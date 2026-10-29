"use client";

import { useEffect, useState } from "react";
import { throughKeyboard } from "@/hooks/useLayoutMode";

/** Controls keep this far either side of the hinge while the Duo lies flat */
export const FOLD_CLEAR = 20;

/**
 * The open Duo's inner display (about 951x669), not any landscape iPhone or
 * iPad: a Pro Max on its side is far wider than tall, an iPad taller
 */
function isOpenDuoSize(width: number, height: number): boolean {
  if (width <= height) return false;
  const flag = window.agentosNative?.duo;
  if (flag !== undefined) return flag;
  return width >= 900 && width <= 1000 && height >= 600 && height <= 720;
}

/**
 * Where the open iPhone Duo's hinge crosses the screen while it lies flat:
 * no fold is reported then, so it is taken as the middle of the inner
 * display (a heuristic). Sets html[data-hinge] with --hinge-x and
 * --fold-clear for the .fold-controls rule; null when not enabled or not an
 * open Duo.
 */
export function useHinge(enabled: boolean): number | null {
  const [hingeX, setHingeX] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setHingeX(null);
      return;
    }
    const isOpenDuo = throughKeyboard(isOpenDuoSize);
    const update = () =>
      setHingeX(
        isOpenDuo(window.innerWidth, window.innerHeight)
          ? window.innerWidth / 2
          : null
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
