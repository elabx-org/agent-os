"use client";

import { useEffect } from "react";
import { proxy, useSnapshot } from "valtio";
import type { Fold } from "@/stores/posture";

/**
 * The posture, decided once: a regular phone, the iPhone Duo closed (the
 * 86px system column on the right), open flat, half open (tabletop: a
 * horizontal fold; book: a vertical one), or a desktop. Components gate on
 * this, never on width alone.
 */
export type LayoutMode =
  | "phone"
  | "duo-closed"
  | "duo-open"
  | "tabletop"
  | "book"
  | "desktop";

/** What the posture is decided from */
export interface LayoutInputs {
  width: number;
  height: number;
  /** pointer: coarse */
  touch: boolean;
  /** The right-hand system column's width (useSideRail's measure), or 0 */
  sideRail: number;
  /** The open Duo lying flat (useHinge's test) */
  openDuo: boolean;
  fold: Fold | null;
  native: boolean;
}

export function layoutModeFor(inputs: LayoutInputs): LayoutMode {
  // Contract stub: U1.2 implements the full table
  return inputs.width < 768 ? "phone" : "desktop";
}

export const layoutStore = proxy<{ mode: LayoutMode; hydrated: boolean }>({
  mode: "desktop",
  hydrated: false,
});

/** The current posture (desktop until the first measure) */
export function useLayoutMode(): LayoutMode {
  return useSnapshot(layoutStore).mode;
}

/**
 * Measures and keeps layoutStore current. Mounted once (app/page.tsx);
 * measures without the side effects of useSideRail/useHinge.
 */
export function useLayoutModeSource(): void {
  useEffect(() => {
    // Contract stub: U1.2 measures every input and listens for changes
    const update = () => {
      layoutStore.mode = layoutModeFor({
        width: window.innerWidth,
        height: window.innerHeight,
        touch: false,
        sideRail: 0,
        openDuo: false,
        fold: null,
        native: false,
      });
      layoutStore.hydrated = true;
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
}
