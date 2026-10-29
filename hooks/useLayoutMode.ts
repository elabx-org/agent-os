"use client";

import { useEffect } from "react";
import { proxy, useSnapshot } from "valtio";
import { subscribeKey } from "valtio/utils";
import { postureStore, type Fold } from "@/stores/posture";

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
  /** agentosNative.duo: app builds that say they run on a Duo */
  duo?: boolean;
}

/** Narrowest right-hand inset that holds the column (as useSideRail) */
export const MIN_SIDE_RAIL = 56;
/** Below this the web lays out for a phone (useViewport's breakpoint) */
const PHONE_MAX_WIDTH = 768;

/**
 * The open Duo's inner display lying flat (about 951x669), as useHinge
 * tells it: the app's own word when it gives one, else the size, and only
 * on a touch screen so a desktop window of that size stays a desktop
 */
export function isOpenDuoSize(
  width: number,
  height: number,
  touch: boolean,
  duo: boolean | undefined
): boolean {
  if (width <= height) return false;
  if (duo !== undefined) return duo;
  return (
    touch && width >= 900 && width <= 1000 && height >= 600 && height <= 720
  );
}

/**
 * Wraps a posture check so the keyboard can't change it. The keyboard only
 * takes height: at the same width a shorter screen keeps the answer it had
 * (the open Duo typing is 951x339, which no longer looks like one), so the
 * pages aren't laid out again under the box being typed into.
 */
export function throughKeyboard(
  check: (width: number, height: number) => boolean
): (width: number, height: number) => boolean {
  let last: { width: number; height: number; result: boolean } | null = null;
  return (width, height) => {
    if (last && last.width === width && height < last.height)
      return last.result;
    const result = check(width, height);
    last = { width, height, result };
    return result;
  };
}

/**
 * The closed Duo inside an app build that doesn't say it is one: the outer
 * display is far squarer (about 466x678) than a regular iPhone (390x844)
 */
function closedDuoGuess(width: number, height: number): boolean {
  return width < PHONE_MAX_WIDTH && width < height && width / height > 0.6;
}

export function layoutModeFor(inputs: LayoutInputs): LayoutMode {
  const { width, height, fold } = inputs;
  if (fold) return fold.axis === "horizontal" ? "tabletop" : "book";
  if (inputs.openDuo) return "duo-open";
  if (inputs.sideRail >= MIN_SIDE_RAIL) return "duo-closed";
  if (inputs.native && width < PHONE_MAX_WIDTH) {
    const closedDuo =
      inputs.duo !== undefined
        ? inputs.duo && width < height
        : closedDuoGuess(width, height);
    return closedDuo ? "duo-closed" : "phone";
  }
  return width < PHONE_MAX_WIDTH ? "phone" : "desktop";
}

export const layoutStore = proxy<{ mode: LayoutMode; hydrated: boolean }>({
  mode: "desktop",
  hydrated: false,
});

/** The current posture (desktop until the first measure) */
export function useLayoutMode(): LayoutMode {
  return useSnapshot(layoutStore).mode;
}

/** ?siderail=86 (or the value it stored) simulates the closed Duo's column */
function sideRailOverride(): number | null {
  try {
    const param = new URLSearchParams(window.location.search).get("siderail");
    if (param !== null) return Number(param) || 0;
    const stored = localStorage.getItem("agentos:siderail");
    return stored === null ? null : Number(stored) || 0;
  } catch {
    return null;
  }
}

/**
 * Measures and keeps layoutStore current. Mounted once (app/page.tsx);
 * measures without the side effects of useSideRail/useHinge.
 */
export function useLayoutModeSource(): void {
  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const openDuo = throughKeyboard((width, height) =>
      isOpenDuoSize(width, height, coarse.matches, window.agentosNative?.duo)
    );
    // The safe-area inset, read the way useSideRail reads it
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;top:0;right:0;height:0;visibility:hidden;pointer-events:none;width:env(safe-area-inset-right)";
    document.body.appendChild(probe);

    const update = () => {
      const native = !!window.agentosNative;
      const duo = window.agentosNative?.duo;
      const width = window.innerWidth;
      const height = window.innerHeight;
      // Inside the app the column is the app's own, never a web inset
      const sideRail =
        sideRailOverride() ??
        (native ? 0 : probe.getBoundingClientRect().width);
      const mode = layoutModeFor({
        width,
        height,
        touch: coarse.matches,
        sideRail,
        openDuo: openDuo(width, height),
        fold: postureStore.fold,
        native,
        duo,
      });
      if (layoutStore.mode !== mode) layoutStore.mode = mode;
      layoutStore.hydrated = true;
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    coarse.addEventListener("change", update);
    const stopFold = subscribeKey(postureStore, "fold", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      coarse.removeEventListener("change", update);
      stopFold();
      probe.remove();
    };
  }, []);
}
