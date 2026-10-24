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

/** The book pose for CSS: html[data-fold="vertical"] and --fold-start/--fold-end */
function markFold(fold: Fold | null) {
  const root = document.documentElement;
  if (fold?.axis === "vertical") {
    root.dataset.fold = "vertical";
    root.style.setProperty("--fold-start", `${fold.start}px`);
    root.style.setProperty("--fold-end", `${fold.end}px`);
  } else {
    delete root.dataset.fold;
    root.style.removeProperty("--fold-start");
    root.style.removeProperty("--fold-end");
  }
}

function applyFold(fold: Fold | null) {
  setFold(fold);
  markFold(fold);
}

/** Keeps postureStore.fold current; mount once */
export function useFoldPosture() {
  useEffect(() => {
    if (isNative() && !simulatedFold()) {
      applyFold(window.agentosNative?.fold ?? null);
      return onNativeEvent((event) => {
        if (event.type === "posture") applyFold(event.fold);
      });
    }
    const update = () => applyFold(simulatedFold() ?? segmentsFold());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
}
