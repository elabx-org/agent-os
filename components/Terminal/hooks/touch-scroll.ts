"use client";

import type { Terminal as XTerm } from "@xterm/xterm";
import type { RefObject } from "react";

interface TouchScrollConfig {
  term: XTerm;
  selectModeRef: RefObject<boolean>;
  wsRef: RefObject<WebSocket | null>;
  /** A finger held still on the terminal (opens select mode to copy) */
  onLongPressRef?: RefObject<(() => void) | undefined>;
}

const LONG_PRESS_MS = 500;
// Finger travel before a touch counts as a swipe (and not a tap or long press)
const SLOP_PX = 10;
// Release velocity is measured over the last stretch of the drag only, so a
// slow start doesn't damp a flick
const VELOCITY_WINDOW_MS = 100;
// A finger that stopped before lifting shouldn't coast
const STILL_BEFORE_LIFT_MS = 60;
// Momentum decays per millisecond, like iOS scroll views (frame-rate
// independent, so a 120Hz screen coasts as far as a 60Hz one)
const DECELERATION = 0.997;
// px/ms: below this a flick doesn't coast, and coasting stops
const MIN_VELOCITY = 0.05;
// Wheel events per frame, so a hard flick can't flood the socket
const MAX_STEPS_PER_FRAME = 20;

// The scrollback is tmux's (copy mode), not xterm's, so it can't scroll
// natively: the finger's travel becomes mouse-wheel events for tmux, one per
// half row as before, and a flick keeps sending them while it decays.
export function setupTouchScroll(config: TouchScrollConfig): () => void {
  const { term, selectModeRef, wsRef, onLongPressRef } = config;

  if (!term.element) return () => {};

  let cleanupInner: (() => void) | null = null;
  let setupTimeout: ReturnType<typeof setTimeout> | null = null;

  const setupTouchScrollInner = () => {
    const xtermScreen = term.element?.querySelector(
      ".xterm-screen"
    ) as HTMLElement | null;
    if (!xtermScreen) {
      setupTimeout = setTimeout(setupTouchScrollInner, 50);
      return;
    }

    // Block native touch handling so the swipe can be turned into tmux scrolling
    xtermScreen.style.touchAction = "none";
    xtermScreen.style.userSelect = "none";
    (
      xtermScreen.style as CSSStyleDeclaration & { webkitUserSelect?: string }
    ).webkitUserSelect = "none";
    xtermScreen.querySelectorAll("canvas").forEach((canvas) => {
      (canvas as HTMLElement).style.touchAction = "none";
    });

    // Pixels of finger travel per wheel event
    const stepPx = () =>
      (term.element ? term.element.offsetHeight / term.rows : 16) * 0.5;

    // SGR mouse wheel at 1;1, batched into one message: 65 up, 64 down
    // (positive steps: finger moving down, i.e. back through history)
    const sendWheel = (steps: number) => {
      const ws = wsRef.current;
      const count = Math.min(Math.abs(steps), MAX_STEPS_PER_FRAME);
      if (!ws || ws.readyState !== WebSocket.OPEN || count === 0) return false;
      const event = steps > 0 ? "\x1b[<65;1;1M" : "\x1b[<64;1;1M";
      try {
        ws.send(JSON.stringify({ type: "input", data: event.repeat(count) }));
        return true;
      } catch (error) {
        console.error("[TouchScroll] Failed to send wheel events:", error);
        return false;
      }
    };

    // The current touch
    let start: { x: number; y: number } | null = null;
    let lastY = 0;
    let vertical: boolean | null = null;
    // Finger travel not yet sent as a wheel event
    let pending = 0;
    let samples: { t: number; y: number }[] = [];

    let momentumRaf: number | null = null;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelLongPress = () => {
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = null;
    };
    const stopMomentum = () => {
      if (momentumRaf !== null) cancelAnimationFrame(momentumRaf);
      momentumRaf = null;
    };
    const endTouch = () => {
      start = null;
      vertical = null;
      samples = [];
    };

    const releaseVelocity = () => {
      const now = performance.now();
      const recent = samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);
      if (recent.length < 2) return 0;
      const first = recent[0];
      const last = recent[recent.length - 1];
      if (now - last.t > STILL_BEFORE_LIFT_MS || last.t === first.t) return 0;
      return (last.y - first.y) / (last.t - first.t);
    };

    const startMomentum = (velocity: number) => {
      let v = velocity;
      let carry = pending;
      let lastTime = performance.now();
      const tick = (time: number) => {
        momentumRaf = null;
        if (selectModeRef.current) return;
        const dt = Math.min(Math.max(time - lastTime, 0), 64);
        lastTime = time;
        // Distance covered while decaying over dt: the integral of v·d^t
        const decay = Math.pow(DECELERATION, dt);
        carry += (v * (decay - 1)) / Math.log(DECELERATION);
        v *= decay;
        const step = stepPx();
        const steps = Math.trunc(carry / step);
        if (steps !== 0) {
          carry -= steps * step;
          if (!sendWheel(steps)) return;
        }
        if (Math.abs(v) >= MIN_VELOCITY)
          momentumRaf = requestAnimationFrame(tick);
      };
      momentumRaf = requestAnimationFrame(tick);
    };

    const handleTouchStart = (e: TouchEvent) => {
      // Any touch catches a coasting scroll, as on iOS
      stopMomentum();
      cancelLongPress();
      if (selectModeRef.current || e.touches.length !== 1) {
        endTouch();
        return;
      }
      const touch = e.touches[0];
      start = { x: touch.clientX, y: touch.clientY };
      lastY = touch.clientY;
      vertical = null;
      pending = 0;
      samples = [{ t: performance.now(), y: touch.clientY }];
      if (onLongPressRef?.current) {
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          endTouch();
          onLongPressRef.current?.();
        }, LONG_PRESS_MS);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (selectModeRef.current || !start || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - start.x);
      const dy = Math.abs(touch.clientY - start.y);
      if (vertical === null) {
        if (dx <= SLOP_PX && dy <= SLOP_PX) return;
        cancelLongPress();
        vertical = dy >= dx;
        // Start from here, so the slop isn't a jump
        lastY = touch.clientY;
      }
      // Horizontal swipes are the parent's (session switching)
      if (!vertical) return;

      e.preventDefault();
      e.stopPropagation();

      const now = performance.now();
      samples.push({ t: now, y: touch.clientY });
      while (samples.length > 2 && now - samples[0].t > VELOCITY_WINDOW_MS)
        samples.shift();

      pending += touch.clientY - lastY;
      lastY = touch.clientY;
      const step = stepPx();
      const steps = Math.trunc(pending / step);
      if (steps !== 0) {
        pending -= steps * step;
        sendWheel(steps);
      }
    };

    const handleTouchEnd = () => {
      cancelLongPress();
      if (vertical) {
        const velocity = releaseVelocity();
        if (Math.abs(velocity) >= MIN_VELOCITY * 3) startMomentum(velocity);
      }
      endTouch();
    };

    const handleTouchCancel = () => {
      cancelLongPress();
      stopMomentum();
      endTouch();
    };

    xtermScreen.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    xtermScreen.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    xtermScreen.addEventListener("touchend", handleTouchEnd);
    xtermScreen.addEventListener("touchcancel", handleTouchCancel);

    cleanupInner = () => {
      cancelLongPress();
      stopMomentum();
      xtermScreen.removeEventListener("touchstart", handleTouchStart);
      xtermScreen.removeEventListener("touchmove", handleTouchMove);
      xtermScreen.removeEventListener("touchend", handleTouchEnd);
      xtermScreen.removeEventListener("touchcancel", handleTouchCancel);
    };
  };

  setupTouchScrollInner();

  return () => {
    if (setupTimeout) clearTimeout(setupTimeout);
    cleanupInner?.();
  };
}
