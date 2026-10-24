"use client";

import { useState, useEffect } from "react";

/**
 * Mobile-first viewport detection hook
 * Breakpoint: 768px (md in Tailwind)
 *
 * isTouch is independent of width: a touch device can be wider than the
 * breakpoint (iPhone Duo inner display is 951pt in landscape) and still
 * needs the terminal keybar.
 */
export function useViewport() {
  const [isMobile, setIsMobile] = useState(false);
  const [isTouch, setIsTouch] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const checkViewport = () => {
      setIsMobile(window.innerWidth < 768);
      setIsTouch(coarse.matches);
    };

    // Initial check
    checkViewport();
    setIsHydrated(true);

    // Listen for resize
    window.addEventListener("resize", checkViewport);
    coarse.addEventListener("change", checkViewport);
    return () => {
      window.removeEventListener("resize", checkViewport);
      coarse.removeEventListener("change", checkViewport);
    };
  }, []);

  return {
    isMobile,
    isDesktop: !isMobile,
    isTouch,
    isHydrated, // For avoiding hydration mismatches
  };
}
