"use client";

import type { Terminal as XTerm } from "@xterm/xterm";
import type { RefObject } from "react";

interface TouchScrollConfig {
  term: XTerm;
  selectModeRef: RefObject<boolean>;
  wsRef: RefObject<WebSocket | null>;
}

export function setupTouchScroll(config: TouchScrollConfig): () => void {
  const { term, selectModeRef, wsRef } = config;

  if (!term.element) return () => {};

  let touchElement: HTMLElement | null = null;
  let handleTouchStart: ((e: TouchEvent) => void) | null = null;
  let handleTouchMove: ((e: TouchEvent) => void) | null = null;
  let handleTouchEnd: (() => void) | null = null;
  let handleTouchCancel: (() => void) | null = null;
  let setupTimeout: NodeJS.Timeout | null = null;

  const setupTouchScrollInner = () => {
    const xtermScreen = term.element?.querySelector(
      ".xterm-screen"
    ) as HTMLElement | null;
    if (!xtermScreen) {
      setupTimeout = setTimeout(setupTouchScrollInner, 50);
      return;
    }

    // Block native touch handling so our JS handlers can intercept and manually scroll
    xtermScreen.style.touchAction = "none";
    xtermScreen.style.userSelect = "none";
    (
      xtermScreen.style as CSSStyleDeclaration & { webkitUserSelect?: string }
    ).webkitUserSelect = "none";

    // Also apply to canvas children
    const canvases = xtermScreen.querySelectorAll("canvas");
    canvases.forEach((canvas) => {
      (canvas as HTMLElement).style.touchAction = "none";
    });

    // Touch state for scroll handling
    let touchState = {
      lastY: null as number | null,
      initialX: null as number | null,
      initialY: null as number | null,
      isHorizontal: null as boolean | null,
      velocityY: 0,
      lastMoveTime: 0,
      scrollAccumulator: 0,
    };

    // Momentum animation state
    let momentumRaf: number | null = null;

    const stopMomentum = () => {
      if (momentumRaf !== null) {
        cancelAnimationFrame(momentumRaf);
        momentumRaf = null;
      }
    };

    const resetTouchState = () => {
      touchState = {
        lastY: null,
        initialX: null,
        initialY: null,
        isHorizontal: null,
        velocityY: 0,
        lastMoveTime: 0,
        scrollAccumulator: 0,
      };
    };

    // Send mouse wheel escape sequences to the PTY
    // These are interpreted by tmux (with mouse mode on) to scroll the pane
    const sendWheelEvents = (lines: number) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const absLines = Math.abs(lines);
      // SGR mouse: \x1b[<65;col;rowM = scroll up, \x1b[<64;col;rowM = scroll down
      const event = lines < 0 ? "\x1b[<65;1;1M" : "\x1b[<64;1;1M";
      for (let i = 0; i < absLines; i++) {
        wsRef.current.send(JSON.stringify({ type: "input", data: event }));
      }
    };

    const startMomentum = () => {
      let velocity = touchState.velocityY;
      let accumulator = 0;
      const friction = 0.95;
      const minVelocity = 0.3;

      const tick = () => {
        velocity *= friction;
        if (Math.abs(velocity) < minVelocity) {
          momentumRaf = null;
          return;
        }

        accumulator += velocity;
        const lines = Math.trunc(accumulator);
        if (lines !== 0) {
          accumulator -= lines;
          sendWheelEvents(lines);
        }

        momentumRaf = requestAnimationFrame(tick);
      };

      momentumRaf = requestAnimationFrame(tick);
    };

    handleTouchStart = (e: TouchEvent) => {
      if (selectModeRef.current || e.touches.length === 0) return;
      stopMomentum();
      const touch = e.touches[0];
      touchState = {
        lastY: touch.clientY,
        initialX: touch.clientX,
        initialY: touch.clientY,
        isHorizontal: null,
        velocityY: 0,
        lastMoveTime: Date.now(),
        scrollAccumulator: 0,
      };
    };

    handleTouchMove = (e: TouchEvent) => {
      if (selectModeRef.current || e.touches.length === 0) return;
      const { lastY, initialX, initialY, isHorizontal } = touchState;
      if (lastY === null || initialX === null || initialY === null) return;

      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - initialX);
      const deltaY = Math.abs(touch.clientY - initialY);

      // Determine swipe direction on first significant movement
      if (isHorizontal === null && (deltaX > 10 || deltaY > 10)) {
        touchState.isHorizontal = deltaX > deltaY;
      }

      // Let parent handle horizontal swipes for session switching
      if (touchState.isHorizontal) return;

      const now = Date.now();
      const moveDeltaY = touch.clientY - lastY;

      // Always capture vertical touches and send to tmux - let tmux handle scrollback
      // (tmux's scrollback is in tmux buffer, not xterm buffer)
      e.preventDefault();
      e.stopPropagation();
      const timeDelta = now - touchState.lastMoveTime;

      // Track velocity for momentum
      if (timeDelta > 0) {
        const instantVelocity = moveDeltaY / timeDelta;
        touchState.velocityY = touchState.velocityY * 0.3 + instantVelocity * 0.7;
      }

      // Get the row height to scroll precisely
      const rowHeight = term.element
        ? term.element.offsetHeight / term.rows
        : 16;

      // Accumulate pixel movement and convert to line-based scrolling
      // Use half a row height as the threshold for responsive feel
      touchState.scrollAccumulator += moveDeltaY;
      const linesToScroll = Math.trunc(
        touchState.scrollAccumulator / (rowHeight * 0.5)
      );

      if (linesToScroll !== 0) {
        touchState.scrollAccumulator -= linesToScroll * (rowHeight * 0.5);
        // Send as mouse wheel events — works for both tmux and non-tmux
        // Natural scrolling: swipe down = scroll up (view earlier content)
        sendWheelEvents(linesToScroll);
      }

      touchState.lastY = touch.clientY;
      touchState.lastMoveTime = now;
    };

    handleTouchEnd = () => {
      const velocity = touchState.velocityY;
      if (Math.abs(velocity) > 0.15) {
        const rowHeight = term.element
          ? term.element.offsetHeight / term.rows
          : 16;
        // Convert px/ms velocity to lines/frame for momentum (natural direction)
        touchState.velocityY = (velocity * 16) / (rowHeight * 0.5);
        startMomentum();
      }
      resetTouchState();
    };

    handleTouchCancel = () => {
      stopMomentum();
      resetTouchState();
    };

    xtermScreen.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    xtermScreen.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    xtermScreen.addEventListener("touchend", handleTouchEnd);
    xtermScreen.addEventListener("touchcancel", handleTouchCancel);

    touchElement = xtermScreen;
  };

  setupTouchScrollInner();

  // Return cleanup function
  return () => {
    if (setupTimeout) clearTimeout(setupTimeout);
    if (touchElement) {
      if (handleTouchStart)
        touchElement.removeEventListener("touchstart", handleTouchStart);
      if (handleTouchMove)
        touchElement.removeEventListener("touchmove", handleTouchMove);
      if (handleTouchEnd)
        touchElement.removeEventListener("touchend", handleTouchEnd);
      if (handleTouchCancel)
        touchElement.removeEventListener("touchcancel", handleTouchCancel);
    }
  };
}
