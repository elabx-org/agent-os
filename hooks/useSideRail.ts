"use client";

import { useEffect, useState } from "react";

/** Narrowest right-hand inset that can hold the nav rail */
const MIN_RAIL_WIDTH = 56;
const OVERRIDE_KEY = "agentos:siderail";

function readOverride(): number | null {
  try {
    const param = new URLSearchParams(window.location.search).get("siderail");
    if (param !== null) {
      localStorage.setItem(OVERRIDE_KEY, param);
      return Number(param) || 0;
    }
    const stored = localStorage.getItem(OVERRIDE_KEY);
    return stored === null ? null : Number(stored) || 0;
  } catch {
    return null;
  }
}

/**
 * Width of the right-hand system column (iPhone Duo outer display reserves
 * ~86pt there for the camera and status), or 0 when there isn't one.
 * `?siderail=86` simulates it; `?siderail=0` clears the override.
 */
export function useSideRail(enabled: boolean): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setWidth(0);
      return;
    }
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;top:0;right:0;height:0;visibility:hidden;pointer-events:none;width:env(safe-area-inset-right)";
    document.body.appendChild(probe);

    const measure = () => {
      const override = readOverride();
      const inset = override ?? probe.getBoundingClientRect().width;
      setWidth(inset >= MIN_RAIL_WIDTH ? Math.round(inset) : 0);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      probe.remove();
    };
  }, [enabled]);

  // Content that pads for the inset reads --safe-right; the rail takes the
  // column over, so that padding goes away while it's shown
  useEffect(() => {
    const root = document.documentElement;
    if (width) root.style.setProperty("--safe-right", "0px");
    else root.style.removeProperty("--safe-right");
  }, [width]);

  return width;
}
