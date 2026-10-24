"use client";

import { useEffect } from "react";
import { isNative, onNativeEvent } from "@/lib/native-bridge";
import { setFold, type Fold } from "@/stores/posture";

/** ?fold=h simulates a half-open fold across the middle (for testing) */
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
  if (new URLSearchParams(window.location.search).get("fold") !== "h")
    return null;
  const middle = window.innerHeight / 2;
  return {
    axis: "horizontal",
    start: middle - SIMULATED_GAP / 2,
    end: middle + SIMULATED_GAP / 2,
  };
}

/** Keeps postureStore.fold current; mount once */
export function useFoldPosture() {
  useEffect(() => {
    if (isNative()) {
      setFold(window.agentosNative?.fold ?? null);
      return onNativeEvent((event) => {
        if (event.type === "posture") setFold(event.fold);
      });
    }
    const update = () => setFold(simulatedFold() ?? segmentsFold());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
}
