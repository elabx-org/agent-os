"use client";

import { useEffect, useState } from "react";

// A docked keyboard takes well over this; browser chrome resizing doesn't
const KEYBOARD_MIN_HEIGHT = 150;

const isTextInput = (el: Element | null) =>
  !!el &&
  el.getAttribute("inputmode") !== "none" &&
  (el.tagName === "TEXTAREA" ||
    (el.tagName === "INPUT" &&
      !["button", "checkbox", "radio", "submit"].includes(
        (el as HTMLInputElement).type
      )) ||
    (el as HTMLElement).isContentEditable);

/**
 * Whether an on-screen keyboard is up: a text input has focus and the visual
 * viewport shrank. xterm focuses itself on load without a keyboard, so focus
 * alone isn't enough.
 */
export function useKeyboardUp(enabled: boolean): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!enabled || !vv) return;
    // Viewport height with no keyboard, per width (rotation and fold change it)
    const baselines = new Map<number, number>();
    const update = () => {
      const width = window.innerWidth;
      const focused = isTextInput(document.activeElement);
      if (!focused) baselines.set(width, vv.height);
      const baseline = baselines.get(width) ?? window.innerHeight;
      setUp(focused && baseline - vv.height >= KEYBOARD_MIN_HEIGHT);
    };
    // The keyboard finishes sliding after focus moves
    const updateSoon = () => {
      update();
      setTimeout(update, 300);
    };
    update();
    vv.addEventListener("resize", update);
    document.addEventListener("focusin", updateSoon);
    document.addEventListener("focusout", updateSoon);
    return () => {
      vv.removeEventListener("resize", update);
      document.removeEventListener("focusin", updateSoon);
      document.removeEventListener("focusout", updateSoon);
    };
  }, [enabled]);
  return enabled && up;
}
