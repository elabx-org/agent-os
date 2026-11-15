"use client";

import { useEffect } from "react";
import { isNative, onNativeEvent } from "@/lib/native-bridge";
import { setFold, type Fold } from "@/stores/posture";

/** ?fold=h (laptop) or ?fold=v (book) simulates a half-open fold through the middle (for testing) */
const SIMULATED_GAP = 24;

interface ViewportSegments {
  segments?: DOMRect[] | null;
}

/** Fold from the Viewport Segments API (experimental in iOS 27.1 Safari) */
function segmentsFold(): Fold | null {
  const segments = (window as unknown as { viewport?: ViewportSegments })
    .viewport?.segments;
  if (!segments || segments.length !== 2) return null;
  const [a, b] = segments;
  if (b.top >= a.bottom - 1) {
    return { axis: "horizontal", start: a.bottom, end: b.top };
  }
  if (b.left >= a.right - 1) {
    return { axis: "vertical", start: a.right, end: b.left };
  }
  return null;
}

function simulatedFold(): Fold | null {
  const param = new URLSearchParams(window.location.search).get("fold");
  if (param !== "h" && param !== "v") return null;
  const middle = (param === "h" ? window.innerHeight : window.innerWidth) / 2;
  return {
    axis: param === "h" ? "horizontal" : "vertical",
    start: middle - SIMULATED_GAP / 2,
    end: middle + SIMULATED_GAP / 2,
  };
}

/**
 * The fold for CSS: html[data-fold="vertical"] (book) or "horizontal"
 * (laptop, tabletop) with --fold-start/--fold-end, from the viewport's left
 * or top
 */
function markFold(fold: Fold | null) {
  const root = document.documentElement;
  if (fold) {
    root.dataset.fold = fold.axis;
    root.style.setProperty("--fold-start", `${fold.start}px`);
    root.style.setProperty("--fold-end", `${fold.end}px`);
  } else {
    delete root.dataset.fold;
    root.style.removeProperty("--fold-start");
    root.style.removeProperty("--fold-end");
  }
}

/** The page's safe area on one side, in CSS pixels */
function safeInset(side: "top" | "left"): number {
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;padding-${side}:env(safe-area-inset-${side},0px)`;
  document.body.appendChild(probe);
  const inset =
    parseFloat(getComputedStyle(probe).getPropertyValue(`padding-${side}`)) ||
    0;
  probe.remove();
  return inset;
}

/**
 * The iOS app measures the fold from the edge of its safe area (under the
 * status strip), but the page runs to the screen's edge: without the inset
 * the fold came out that much too high, and the deck's keys started above
 * the hinge. A fold the page doesn't reach past (the keyboard covers the
 * half below it) is no fold.
 */
function fromApp(fold: Fold | null): Fold | null {
  if (!fold) return null;
  const across = fold.axis === "horizontal";
  const inset = safeInset(across ? "top" : "left");
  const size = across ? window.innerHeight : window.innerWidth;
  const end = fold.end + inset;
  return end < size ? { ...fold, start: fold.start + inset, end } : null;
}

function applyFold(fold: Fold | null) {
  setFold(fold);
  markFold(fold);
}

/** Keeps postureStore.fold current; mount once */
export function useFoldPosture() {
  useEffect(() => {
    if (isNative() && !simulatedFold()) {
      // As the app last sent it; the page's own size decides again on a
      // resize (the keyboard leaving reports the fold before the page grows)
      let sent = window.agentosNative?.fold ?? null;
      const place = () => applyFold(fromApp(sent));
      place();
      const stop = onNativeEvent((event) => {
        if (event.type !== "posture") return;
        sent = event.fold;
        place();
      });
      window.addEventListener("resize", place);
      return () => {
        stop();
        window.removeEventListener("resize", place);
      };
    }
    const update = () => applyFold(simulatedFold() ?? segmentsFold());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
}
