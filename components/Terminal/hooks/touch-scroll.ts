"use client";

import type { Terminal as XTerm } from "@xterm/xterm";
import type { RefObject } from "react";
import { coast, MIN_VELOCITY } from "@/lib/terminal-history";
import type { HistoryLayer } from "./history-layer";

interface TouchScrollConfig {
  term: XTerm;
  selectModeRef: RefObject<boolean>;
  wsRef: RefObject<WebSocket | null>;
  /** A finger held still on the terminal (opens select mode to copy) */
  onLongPressRef?: RefObject<(() => void) | undefined>;
  /** The history, scrolled on the device: a swipe back opens it */
  history?: HistoryLayer;
}

const LONG_PRESS_MS = 500;
// Finger travel before a touch counts as a swipe (and not a tap or long press)
const SLOP_PX = 10;
// Release velocity is measured over the last stretch of the drag only, so a
// slow start doesn't damp a flick
const VELOCITY_WINDOW_MS = 100;
// A finger that stopped before lifting shouldn't coast
const STILL_BEFORE_LIFT_MS = 60;
// Wheel events per frame, so a hard flick can't flood the socket
const MAX_STEPS_PER_FRAME = 20;
// After a swipe found no history to show, swipes scroll tmux this long
const HISTORY_RETRY_MS = 5000;

// The scrollback is tmux's, not xterm's. A swipe back through it opens the
// history layer (history-layer.ts), which the device scrolls itself. Where
// there's none to show (a full-screen or mouse app) or going forward, the
// finger's travel becomes mouse-wheel events for tmux or the app: one per
// row of travel (tmux scrolls a row per event, lib/init-script.ts), sent at
// most once a frame, and a flick keeps sending them while it decays.
export function setupTouchScroll(config: TouchScrollConfig): () => void {
  const { term, selectModeRef, wsRef, onLongPressRef, history } = config;

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

    // Pixels of finger travel per wheel event: a row
    const stepPx = () =>
      xtermScreen.offsetHeight > 0 ? xtermScreen.offsetHeight / term.rows : 16;

    // SGR mouse wheel at 1;1, batched into one message: 64 wheel up, 65 wheel down
    // (positive steps: finger moving down, i.e. back through history)
    const sendWheel = (steps: number) => {
      const ws = wsRef.current;
      const count = Math.min(Math.abs(steps), MAX_STEPS_PER_FRAME);
      if (!ws || ws.readyState !== WebSocket.OPEN || count === 0) return false;
      const event = steps > 0 ? "\x1b[<64;1;1M" : "\x1b[<65;1;1M";
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
    // This swipe moves the history layer, not tmux
    let toHistory = false;
    let historyFailedAt = -Infinity;
    // The swipe opening the history, until its rows come
    let historySwipe: { travel: number } | null = null;
    // Finger travel not yet sent as a wheel event
    let pending = 0;
    // Wheel steps waiting for the next frame
    let queuedSteps = 0;
    let flushRaf: number | null = null;
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
    // Wheel events go out once a frame, however many touch moves came in
    const flush = () => {
      flushRaf = null;
      const steps = queuedSteps;
      queuedSteps = 0;
      if (steps !== 0) sendWheel(steps);
    };
    const queueWheel = (steps: number) => {
      queuedSteps += steps;
      if (flushRaf === null) flushRaf = requestAnimationFrame(flush);
    };
    const endTouch = () => {
      start = null;
      vertical = null;
      toHistory = false;
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
        const glide = coast(v, dt);
        carry += glide.distance;
        v = glide.v;
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
      queuedSteps = 0;
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
        // Back through history (finger down): the device scrolls it.
        // Opening fetches the rows; the travel until then is applied when
        // they come. With none to show, tmux scrolls (and for a while
        // after, so a full-screen app isn't asked every swipe)
        if (
          vertical &&
          history &&
          (history.isOpen ||
            (touch.clientY > start.y &&
              performance.now() - historyFailedAt > HISTORY_RETRY_MS))
        ) {
          toHistory = true;
          const swipe = { travel: 0 };
          historySwipe = swipe;
          void history.open().then((result) => {
            if (result === "shown") return;
            if (result === "none") historyFailedAt = performance.now();
            // The travel so far goes to tmux or the app instead, and the
            // rest of this swipe too
            if (historySwipe === swipe) {
              historySwipe = null;
              if (start) toHistory = false;
            }
            const steps = Math.trunc(swipe.travel / stepPx());
            if (steps !== 0) queueWheel(steps);
          });
        }
      }
      // Horizontal swipes are the parent's (session switching)
      if (!vertical) return;

      e.preventDefault();
      e.stopPropagation();

      const now = performance.now();
      samples.push({ t: now, y: touch.clientY });
      while (samples.length > 2 && now - samples[0].t > VELOCITY_WINDOW_MS)
        samples.shift();

      if (toHistory) {
        if (historySwipe) historySwipe.travel += touch.clientY - lastY;
        history?.drag(touch.clientY - lastY);
        lastY = touch.clientY;
        return;
      }

      pending += touch.clientY - lastY;
      lastY = touch.clientY;
      const step = stepPx();
      const steps = Math.trunc(pending / step);
      if (steps !== 0) {
        pending -= steps * step;
        queueWheel(steps);
      }
    };

    const handleTouchEnd = () => {
      cancelLongPress();
      if (vertical) {
        const velocity = releaseVelocity();
        if (toHistory) history?.fling(velocity);
        else if (Math.abs(velocity) >= MIN_VELOCITY * 3)
          startMomentum(velocity);
      }
      endTouch();
    };

    const handleTouchCancel = () => {
      cancelLongPress();
      stopMomentum();
      if (toHistory) history?.fling(0);
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
      if (flushRaf !== null) cancelAnimationFrame(flushRaf);
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
