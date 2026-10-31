"use client";

import type { Terminal as XTerm } from "@xterm/xterm";
import {
  coast,
  historyCommand,
  historyPalette,
  MIN_VELOCITY,
  newHistoryStyle,
  parseHistory,
  rowToHtml,
  type HistoryPalette,
} from "@/lib/terminal-history";

// Rows per block: the history is laid out as blocks of known height from
// the start, each filled with its rows when it nears the screen, so loading
// never moves what's on screen (and never stops a native scroll)
const BLOCK_ROWS = 100;
// Rows fetched when it opens: a few screens, quick to arrive
const FIRST_ROWS = 300;
// Blocks per fetch at most
const FETCH_BLOCKS = 10;
// Blocks are filled this many screens ahead
const AHEAD_SCREENS = 3;
// The view settles this long after its last scroll before it counts as
// back at the bottom
const SETTLE_MS = 120;
const LONG_PRESS_MS = 500;
const SLOP_PX = 10;

export type OpenResult = "shown" | "none" | "closed";

export interface HistoryLayerConfig {
  term: XTerm;
  /** Runs a shell command over the terminal's socket; its whole stdout */
  exec: (command: string) => Promise<string | null>;
  /** A finger held still on the history (opens select mode) */
  onLongPressRef?: { current: (() => void) | undefined };
}

export interface HistoryLayer {
  /** True while the history covers the live terminal */
  readonly isOpen: boolean;
  /**
   * Fetches the pane's history and shows it over the terminal, at the
   * bottom (where the live screen is). Resolves "none" when there's none to
   * show (a full-screen or mouse app, no tmux, no socket): the caller
   * scrolls tmux instead; "closed" when closed before the rows came.
   */
  open(): Promise<OpenResult>;
  /** Moves the history by a finger's travel (px, positive: finger down) */
  drag(dy: number): void;
  /** Coasts from a release velocity (px/ms, positive: finger down) */
  fling(velocity: number): void;
  /** Back to the live terminal */
  close(): void;
  /** Rows the view is scrolled up from the bottom, while open */
  rowsFromBottom(): number | null;
  dispose(): void;
}

let styleInjected = false;
function injectStyle() {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  const el = document.createElement("style");
  el.textContent = `
.agentos-history{position:absolute;z-index:6;overflow-x:hidden;overflow-y:auto;overflow-anchor:none;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;scrollbar-width:none;contain:strict}
.agentos-history::-webkit-scrollbar{display:none}
.agentos-history>div{content-visibility:auto;overflow:hidden}
.agentos-history>div>div{white-space:pre;overflow:hidden;height:var(--row)}
`;
  document.head.appendChild(el);
}

/**
 * The pane's tmux history, drawn like the terminal and scrolled by the
 * device itself: on the first swipe back it covers the live terminal at
 * the bottom of the history, the swipe and its momentum move it locally
 * (no round trip to tmux per row), later swipes scroll it natively, and it
 * goes away at the bottom or when anything is typed.
 */
export function createHistoryLayer(config: HistoryLayerConfig): HistoryLayer {
  const { term, exec, onLongPressRef } = config;
  injectStyle();

  let el: HTMLDivElement | null = null;
  let isOpen = false;
  // While open: the blocks, those filled or on their way
  let blocks: HTMLDivElement[] = [];
  let filled = new Set<number>();
  let total = 0;
  let rowPx = 16;
  let palette: HistoryPalette | null = null;
  let rgb = false;
  let cols = 0;
  // Copy mode was scrolled when it opened: leave it at the bottom
  let tmuxScrolled = false;
  // A swipe or fling that arrived before the rows
  let queued = 0;
  let queuedVelocity = 0;
  let opening: Promise<OpenResult> | null = null;
  let generation = 0;
  // Finger travel not applied yet (applied once per frame)
  let pendingDrag = 0;
  let dragRaf: number | null = null;
  let momentumRaf: number | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let touching = false;
  // A swipe that started on the terminal drags it (touch-scroll.ts)
  let held = false;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let touchStart: { x: number; y: number } | null = null;

  const maxScroll = () => (el ? el.scrollHeight - el.clientHeight : 0);
  const atBottom = () => !!el && el.scrollTop >= maxScroll() - 1;

  const stopMomentum = () => {
    if (momentumRaf !== null) cancelAnimationFrame(momentumRaf);
    momentumRaf = null;
  };

  const cancelLongPress = () => {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
  };

  // Rows as HTML, one element each; a fetch starts from plain text
  const rowsHtml = (rows: string[]) => {
    if (!palette) return "";
    const style = newHistoryStyle();
    let html = "";
    for (const row of rows)
      html += `<div>${rowToHtml(row, style, palette)}</div>`;
    return html;
  };

  // Rows from..to: into their blocks
  const fill = (from: number, rows: string[]) => {
    for (let i = 0; i < rows.length; ) {
      const b = Math.floor((from + i) / BLOCK_ROWS);
      const block = blocks[b];
      if (!block) break;
      const take = Math.min(rows.length - i, (b + 1) * BLOCK_ROWS - (from + i));
      block.innerHTML = rowsHtml(rows.slice(i, i + take));
      i += take;
    }
  };

  // The blocks near the screen that are still empty: fetched, a run of
  // them at a time
  const fillAhead = () => {
    if (!el || !isOpen) return;
    const screenRows = el.clientHeight / rowPx;
    const first = Math.floor(el.scrollTop / rowPx - screenRows * AHEAD_SCREENS);
    const last = Math.ceil(
      (el.scrollTop + el.clientHeight) / rowPx + screenRows * AHEAD_SCREENS
    );
    const lo = Math.max(0, Math.floor(first / BLOCK_ROWS));
    const hi = Math.min(blocks.length - 1, Math.floor(last / BLOCK_ROWS));
    // Nearest the bottom of the screen first: where a swipe back goes
    for (let b = hi; b >= lo; b--) {
      if (filled.has(b)) continue;
      let start = b;
      while (
        start > lo &&
        !filled.has(start - 1) &&
        b - start + 1 < FETCH_BLOCKS
      )
        start--;
      for (let k = start; k <= b; k++) filled.add(k);
      void fetchBlocks(start, b);
      b = start;
    }
  };

  const fetchBlocks = async (first: number, last: number) => {
    const gen = generation;
    const from = first * BLOCK_ROWS;
    const to = Math.min((last + 1) * BLOCK_ROWS, total) - 1;
    const out = await exec(historyCommand({ from, to }));
    if (gen !== generation) return;
    const parsed = out === null ? null : parseHistory(out);
    if (!parsed) {
      // Again when next near the screen
      for (let k = first; k <= last; k++) filled.delete(k);
      return;
    }
    fill(from, parsed.rows);
  };

  // Back at the bottom with nothing moving it: the live terminal again
  const settle = () => {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (
        !isOpen ||
        touching ||
        held ||
        momentumRaf !== null ||
        dragRaf !== null
      )
        return;
      if (atBottom()) close();
    }, SETTLE_MS);
  };

  const onScroll = () => {
    fillAhead();
    settle();
  };

  // Later touches land on the history: it scrolls natively; a finger held
  // still opens select mode, as on the terminal
  const onTouchStart = (e: TouchEvent) => {
    touching = true;
    stopMomentum();
    cancelLongPress();
    if (e.touches.length !== 1) return;
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (onLongPressRef?.current) {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        onLongPressRef.current?.();
      }, LONG_PRESS_MS);
    }
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!touchStart || !longPressTimer) return;
    const t = e.touches[0];
    if (
      Math.abs(t.clientX - touchStart.x) > SLOP_PX ||
      Math.abs(t.clientY - touchStart.y) > SLOP_PX
    )
      cancelLongPress();
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length > 0) return;
    touching = false;
    touchStart = null;
    cancelLongPress();
    settle();
  };
  // A desktop wheel over the history scrolls it natively, not tmux
  const onWheel = (e: WheelEvent) => {
    e.stopPropagation();
    settle();
  };

  const ensureElement = (): HTMLDivElement | null => {
    const host = term.element;
    const screen = host?.querySelector<HTMLElement>(".xterm-screen");
    if (!host || !screen) return null;
    if (!el) {
      el = document.createElement("div");
      el.className = "agentos-history";
      el.setAttribute("aria-hidden", "true");
      el.addEventListener("scroll", onScroll, { passive: true });
      el.addEventListener("touchstart", onTouchStart, { passive: true });
      el.addEventListener("touchmove", onTouchMove, { passive: true });
      el.addEventListener("touchend", onTouchEnd, { passive: true });
      el.addEventListener("touchcancel", onTouchEnd, { passive: true });
      el.addEventListener("wheel", onWheel, { passive: true });
    }
    if (el.parentElement !== host) host.appendChild(el);
    // Exactly over the terminal's rows, in its font and colours
    // (fractional: xterm sizes the screen to its cells, which offset*
    // sizes would round)
    const theme = term.options.theme ?? {};
    const box = screen.getBoundingClientRect();
    const hostBox = host.getBoundingClientRect();
    const cell = cellSize(term);
    rowPx = cell?.height ?? box.height / term.rows;
    const cellPx = cell?.width ?? box.width / term.cols;
    const font = `${term.options.fontSize ?? 14}px ${term.options.fontFamily ?? "monospace"}`;
    Object.assign(el.style, {
      left: `${box.left - hostBox.left - host.clientLeft}px`,
      top: `${box.top - hostBox.top - host.clientTop}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      background: theme.background ?? "#000",
      color: theme.foreground ?? "#fff",
      font,
      fontWeight: String(term.options.fontWeight ?? "normal"),
      lineHeight: `${rowPx}px`,
      letterSpacing: `${cellPx - charWidth(font, term.options.fontWeight)}px`,
    });
    el.style.setProperty("--row", `${rowPx}px`);
    el.style.setProperty(
      "--bold",
      String(term.options.fontWeightBold ?? "bold")
    );
    for (const block of blocks)
      block.style.height = `${Number(block.dataset.rows) * rowPx}px`;
    palette = historyPalette(
      theme as Record<string, string | undefined>,
      term.options.drawBoldTextInBrightColors !== false,
      rgb
    );
    return el;
  };

  // Every row's place from the start, empty until filled
  const layOut = (rows: number) => {
    if (!el) return;
    total = rows;
    el.textContent = "";
    blocks = [];
    filled = new Set();
    for (let start = 0; start < total; start += BLOCK_ROWS) {
      const block = document.createElement("div");
      const rows = Math.min(BLOCK_ROWS, total - start);
      block.dataset.rows = String(rows);
      block.style.height = `${rows * rowPx}px`;
      blocks.push(block);
    }
    el.append(...blocks);
  };

  const applyDrag = () => {
    dragRaf = null;
    if (!el || !isOpen || pendingDrag === 0) return;
    el.scrollTop -= pendingDrag;
    pendingDrag = 0;
  };

  const startFling = (velocity: number) => {
    stopMomentum();
    if (!el || Math.abs(velocity) < MIN_VELOCITY * 3) {
      settle();
      return;
    }
    let v = velocity;
    let carry = 0;
    let last = performance.now();
    const tick = (time: number) => {
      momentumRaf = null;
      if (!el || !isOpen) return;
      const dt = Math.min(Math.max(time - last, 0), 64);
      last = time;
      const step = coast(v, dt);
      v = step.v;
      carry += step.distance;
      const whole = Math.trunc(carry);
      carry -= whole;
      const before = el.scrollTop;
      el.scrollTop -= whole;
      const stuck = whole !== 0 && el.scrollTop === before;
      if (Math.abs(v) >= MIN_VELOCITY && !stuck)
        momentumRaf = requestAnimationFrame(tick);
      else settle();
    };
    momentumRaf = requestAnimationFrame(tick);
  };

  const open = (): Promise<OpenResult> => {
    if (isOpen) return Promise.resolve("shown");
    if (opening) return opening;
    const gen = ++generation;
    queued = 0;
    queuedVelocity = 0;
    opening = (async (): Promise<OpenResult> => {
      const out = await exec(
        historyCommand({ last: FIRST_ROWS, block: BLOCK_ROWS })
      );
      if (gen !== generation) return "closed";
      const parsed = out === null ? null : parseHistory(out);
      if (
        !parsed ||
        parsed.header.alternate ||
        parsed.header.mouseApp ||
        (parsed.header.historySize === 0 && parsed.header.scrolled === 0)
      )
        return "none";
      rgb = parsed.header.rgb;
      if (!ensureElement() || !el) return "none";
      cols = term.cols;
      // Rows count from the oldest; these end with the screen
      const from = parsed.header.start + parsed.header.historySize;
      layOut(from + parsed.rows.length);
      fill(from, parsed.rows);
      for (let b = Math.floor(from / BLOCK_ROWS); b < blocks.length; b++)
        filled.add(b);
      tmuxScrolled = parsed.header.scrolled > 0;
      el.style.display = "block";
      isOpen = true;
      el.scrollTop = maxScroll() - parsed.header.scrolled * rowPx;
      // What the finger did while the rows were on their way
      if (queued) {
        pendingDrag += queued;
        applyDrag();
      }
      if (queuedVelocity) startFling(queuedVelocity);
      queued = queuedVelocity = 0;
      fillAhead();
      return "shown";
    })().finally(() => {
      opening = null;
    });
    return opening;
  };

  const close = () => {
    generation++;
    held = false;
    stopMomentum();
    cancelLongPress();
    if (dragRaf !== null) cancelAnimationFrame(dragRaf);
    dragRaf = null;
    pendingDrag = 0;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
    if (!isOpen) return;
    isOpen = false;
    if (el) {
      el.style.display = "none";
      el.textContent = "";
    }
    blocks = [];
    filled = new Set();
    // tmux was scrolled back when this opened; it's at the bottom now
    if (tmuxScrolled) {
      tmuxScrolled = false;
      void exec(
        "P=$(tmux list-clients -F '#{client_tty} #{pane_id}' 2>/dev/null | awk -v t=\"$AGENT_OS_TTY\" '$1 == t { print $2 }'); " +
          '[ -n "$P" ] && tmux send-keys -t "$P" -X cancel 2>/dev/null'
      );
    }
  };

  // New columns: tmux wraps the rows again, so these are out of date. New
  // rows only (the keyboard, the key row): the same rows in a new height
  const resized = term.onResize(() => {
    if (!isOpen || !el) return;
    if (term.cols !== cols) return close();
    const fromBottom = maxScroll() - el.scrollTop;
    ensureElement();
    el.scrollTop = maxScroll() - fromBottom;
  });

  return {
    get isOpen() {
      return isOpen;
    },
    open,
    drag(dy) {
      held = true;
      if (!isOpen) {
        queued += dy;
        return;
      }
      stopMomentum();
      pendingDrag += dy;
      if (dragRaf === null) dragRaf = requestAnimationFrame(applyDrag);
    },
    fling(velocity) {
      held = false;
      if (!isOpen) {
        queuedVelocity = velocity;
        return;
      }
      if (dragRaf !== null) {
        cancelAnimationFrame(dragRaf);
        applyDrag();
      }
      startFling(velocity);
    },
    close,
    rowsFromBottom() {
      if (!isOpen || !el) return null;
      return Math.round((maxScroll() - el.scrollTop) / rowPx);
    },
    dispose() {
      close();
      resized.dispose();
      el?.remove();
      el = null;
    },
  };
}

// The renderer's cell in CSS px (whole device pixels, so a column can be
// narrower than the screen's width over the columns). Not public API: on
// another xterm, the screen's size over its rows and columns
function cellSize(term: XTerm): { width: number; height: number } | null {
  const cell = (
    term as unknown as {
      _core?: {
        _renderService?: {
          dimensions?: { css?: { cell?: { width: number; height: number } } };
        };
      };
    }
  )._core?._renderService?.dimensions?.css?.cell;
  return cell && cell.width > 0 && cell.height > 0 ? cell : null;
}

// The font's own advance, to space it out to the terminal's cells
function charWidth(font: string, weight: unknown): number {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.font = `${weight && weight !== "normal" ? `${weight} ` : ""}${font}`;
  return ctx.measureText("W".repeat(50)).width / 50;
}
