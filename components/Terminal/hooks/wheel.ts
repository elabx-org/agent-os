"use client";

import type { Terminal as XTerm } from "@xterm/xterm";
import type { RefObject } from "react";
import { createWheelCounter } from "@/lib/wheel-rows";

// Wheel events per wheel turn at most, so a fast trackpad can't flood
const MAX_EVENTS = 20;

/**
 * A mouse wheel or trackpad over the terminal while tmux (or an app) reads
 * the mouse: one wheel event per row of travel, where xterm sends one per
 * turn of the wheel whatever its size. tmux scrolls a row per event
 * (lib/init-script.ts), so the history moves as far as the page would.
 * lib/wheel-rows.ts says how many rows an event is.
 */
export function setupWheel(
  term: XTerm,
  wsRef: RefObject<WebSocket | null>
): () => void {
  const rowsOf = createWheelCounter();
  term.attachCustomWheelEventHandler((ev) => {
    // xterm's own scrollback (no tmux): xterm scrolls it
    if (term.modes.mouseTrackingMode === "none" || ev.deltaY === 0) return true;
    const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
    const ws = wsRef.current;
    if (!screen || !ws || ws.readyState !== WebSocket.OPEN) return true;
    const rowPx = screen.offsetHeight / term.rows || 16;
    // When the wheel moved, not when the page got to it
    const when = ev.timeStamp > 0 ? ev.timeStamp : performance.now();
    const n = rowsOf(ev, rowPx, term.rows, when);
    ev.preventDefault();
    if (n === 0) return false;
    // At the pointer, so it scrolls the tmux pane under it
    const rect = screen.getBoundingClientRect();
    const col = Math.min(
      term.cols,
      Math.max(
        1,
        Math.floor(((ev.clientX - rect.left) / rect.width) * term.cols) + 1
      )
    );
    const row = Math.min(
      term.rows,
      Math.max(1, Math.floor((ev.clientY - rect.top) / rowPx) + 1)
    );
    const event = `\x1b[<${n < 0 ? 64 : 65};${col};${row}M`;
    ws.send(
      JSON.stringify({
        type: "input",
        data: event.repeat(Math.min(Math.abs(n), MAX_EVENTS)),
      })
    );
    return false;
  });
  return () => term.attachCustomWheelEventHandler(() => true);
}
