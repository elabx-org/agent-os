"use client";

import { useEffect } from "react";

/**
 * Fixed layers such as the home stop short of a bar with --control-bar-h.
 * A bar in the flow below the pane also keeps clear of the home indicator
 * itself, so the pane needn't (--pane-inset-bottom: 0)
 */
export function useBarHeight(height: string | null, inFlow: boolean) {
  useEffect(() => {
    if (!height) return;
    const root = document.documentElement;
    root.style.setProperty("--control-bar-h", height);
    if (inFlow) root.style.setProperty("--pane-inset-bottom", "0px");
    return () => {
      root.style.removeProperty("--control-bar-h");
      if (inFlow) root.style.removeProperty("--pane-inset-bottom");
    };
  }, [height, inFlow]);
}
