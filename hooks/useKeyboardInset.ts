"use client";

import { useEffect, useState } from "react";

export type KeyboardMode = "hidden" | "docked" | "floating";

export interface KeyboardInset {
  /** Pixels of the layout viewport covered by a docked on-screen keyboard */
  height: number;
  /**
   * hidden: no text input focused
   * docked: keyboard shrinks the visual viewport (normal iOS keyboard)
   * floating: input tapped but the viewport barely shrank, so the keyboard
   *   is split/undocked/floating (or a hardware keyboard) and covers content
   *   the page can't measure
   */
  mode: KeyboardMode;
}

// A docked iPhone keyboard is well over this; the form accessory bar alone is ~45px
const DOCKED_MIN_HEIGHT = 150;
// iOS only opens the keyboard for focus that follows a tap; programmatic focus
// (xterm focuses its textarea on load) leaves the keyboard closed
const TAP_TO_FOCUS_MS = 1000;
// A docked keyboard finishes sliding in well within this; only call the
// keyboard floating once it has had time to shrink the viewport and didn't
const FLOATING_CONFIRM_MS = 600;
// With a docked keyboard leaving less than this, chrome marked .kb-compact-hide
// is hidden so the terminal keeps enough rows to show the line being typed
const COMPACT_BELOW_HEIGHT = 560;
// No keyboard covers more than this share of the screen; a bigger reading is
// a stale measurement, not a keyboard
const MAX_KEYBOARD_SHARE = 0.6;

// inputmode="none" inputs (xterm while the composer is on) never open a keyboard
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
 * Measures the on-screen keyboard from visualViewport against the *current*
 * layout viewport, so the value stays right across rotation and fold/unfold.
 */
export function useKeyboardInset(enabled: boolean): KeyboardInset {
  const [inset, setInset] = useState<KeyboardInset>({
    height: 0,
    mode: "hidden",
  });

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    // Layout height with no keyboard, per width (rotation/fold change width).
    // Browsers honouring interactive-widget=resizes-content shrink the layout
    // viewport itself, so the keyboard shows up here rather than in visualViewport.
    const baselines = new Map<number, number>();
    // Visual viewport height with no keyboard, per width. After a fold/unfold
    // iOS Safari can keep a stale, too-tall innerHeight for the life of the
    // tab (reloads included), so the keyboard is measured against this instead.
    const visualBaselines = new Map<number, number>();
    let lastTouch = 0;
    let tappedIntoInput = false;

    const update = () => {
      const focused = isTextInput(document.activeElement);
      const width = window.innerWidth;
      if (!focused) {
        baselines.set(width, window.innerHeight);
        visualBaselines.set(width, vv.height + vv.offsetTop);
      }
      const baseline = baselines.get(width) ?? window.innerHeight;
      const layoutShrink = baseline - window.innerHeight;

      // With nothing to type into there is no keyboard, whatever the numbers say
      let height = 0;
      if (focused) {
        const layoutHeight = Math.min(
          window.innerHeight,
          visualBaselines.get(width) ?? window.innerHeight
        );
        height = Math.max(
          0,
          Math.round(layoutHeight - vv.height - vv.offsetTop)
        );
        if (height > layoutHeight * MAX_KEYBOARD_SHARE) height = 0;
      }
      const mode: KeyboardMode = !focused
        ? "hidden"
        : height >= DOCKED_MIN_HEIGHT || layoutShrink >= DOCKED_MIN_HEIGHT
          ? "docked"
          : tappedIntoInput
            ? "floating"
            : "hidden";
      setInset((prev) =>
        prev.height === height && prev.mode === mode ? prev : { height, mode }
      );

      const root = document.documentElement;
      root.dataset.keyboard = mode;
      root.toggleAttribute(
        "data-keyboard-compact",
        mode === "docked" && vv.height < COMPACT_BELOW_HEIGHT
      );
    };

    // Keyboard animation and focus changes settle after the event fires
    const updateSoon = () => {
      update();
      setTimeout(update, 300);
    };
    // xterm keeps its textarea focused, so tapping the terminal opens the
    // keyboard without a new focusin event
    const markTapped = () => {
      setTimeout(() => {
        if (isTextInput(document.activeElement)) {
          tappedIntoInput = true;
          update();
        }
      }, FLOATING_CONFIRM_MS);
    };
    const onTouch = (e: TouchEvent) => {
      lastTouch = Date.now();
      const target = e.target as Element | null;
      if (target?.closest?.(".xterm") || isTextInput(target)) markTapped();
    };
    const onFocusIn = () => {
      if (Date.now() - lastTouch < TAP_TO_FOCUS_MS) markTapped();
      updateSoon();
    };
    const onFocusOut = () => {
      tappedIntoInput = false;
      updateSoon();
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", updateSoon);
    document.addEventListener("touchend", onTouch, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", updateSoon);
      document.removeEventListener("touchend", onTouch, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      delete document.documentElement.dataset.keyboard;
      document.documentElement.removeAttribute("data-keyboard-compact");
    };
  }, [enabled]);

  return enabled ? inset : { height: 0, mode: "hidden" };
}
