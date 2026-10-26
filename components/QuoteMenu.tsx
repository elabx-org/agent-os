"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { gestures } from "@/lib/gestures";
import { addQuote } from "@/stores/replyQuotes";
import { postureStore } from "@/stores/posture";

const HOLD_MS = 350;
const MOVE_PX = 8;
/** A quotable block of a message Markdown rendered with `quotable` */
const BLOCK = "[data-quotable] [data-quote]";

interface Open {
  x: number;
  y: number;
  block: HTMLElement;
  /** Text selected inside the message, which goes instead of the block */
  selection: string;
  /** Opened with a mouse: the menu takes the focus for the keys */
  mouse?: boolean;
}

/** The status strip's height (env() only reads in CSS) */
function safeTop(): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top)";
  document.body.appendChild(probe);
  const top = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return top;
}

/** What's selected, if it lies inside the block's message */
function selectionIn(block: HTMLElement) {
  const sel = window.getSelection();
  const root = block.closest("[data-quotable]");
  if (!sel || sel.isCollapsed || !root) return "";
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return "";
  return sel.toString().trim();
}

// iOS would start its own selection a moment after the hold registers
const NO_SELECT = [
  "-webkit-user-select",
  "user-select",
  "-webkit-touch-callout",
];

function primary(alpha: number) {
  const hsl = getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
    .trim();
  return hsl ? `hsl(${hsl} / ${alpha})` : "transparent";
}

/**
 * "Reply to this" on Claude's messages: hold a paragraph, list item, heading
 * or code block (or right-click it) for Copy / Reply to this / Select. Reply
 * pins the block as a quote over the composer and focuses it. Short taps,
 * links and scrolling are untouched, and a right-click off a block keeps the
 * browser's own menu.
 */
export function useQuoteMenu({
  sessionId,
  onQuoted,
}: {
  sessionId: string;
  /** Called from the tap, so focusing the composer raises the keyboard */
  onQuoted: () => void;
}) {
  const [open, setOpen] = useState<Open | null>(null);
  const touch = useRef<{
    x: number;
    y: number;
    block: HTMLElement;
    timer: ReturnType<typeof setTimeout>;
    held: boolean;
  } | null>(null);
  const heldAt = useRef(0);
  const unstyled = useRef<HTMLElement | null>(null);

  const allowSelect = () => {
    const root = unstyled.current;
    if (root) for (const prop of NO_SELECT) root.style.removeProperty(prop);
    unstyled.current = null;
  };
  const cancel = () => {
    if (touch.current) clearTimeout(touch.current.timer);
    touch.current = null;
  };
  useEffect(() => () => cancel(), []);

  const onTouchStart = (e: ReactTouchEvent) => {
    cancel();
    if (e.touches.length !== 1) return;
    const target = e.target as Element;
    // The code block's own Copy button, say
    if (target.closest("button")) return;
    const block = target.closest<HTMLElement>(BLOCK);
    if (!block) return;
    const t = e.touches[0];
    const state = {
      x: t.clientX,
      y: t.clientY,
      block,
      held: false,
      timer: setTimeout(() => {
        if (gestures.dragging || gestures.swiping) return;
        state.held = true;
        haptic("medium");
        const root = block.closest<HTMLElement>("[data-quotable]");
        if (root) {
          for (const prop of NO_SELECT) root.style.setProperty(prop, "none");
          unstyled.current = root;
        }
      }, HOLD_MS),
    };
    touch.current = state;
  };
  const onTouchMove = (e: ReactTouchEvent) => {
    const state = touch.current;
    if (!state) return;
    const t = e.touches[0];
    if (Math.hypot(t.clientX - state.x, t.clientY - state.y) > MOVE_PX) {
      cancel();
      allowSelect();
    }
  };
  const onTouchEnd = (e: ReactTouchEvent) => {
    const state = touch.current;
    cancel();
    allowSelect();
    if (!state?.held || gestures.dragging || gestures.swiping) return;
    // No click, so a link under the finger doesn't open
    e.preventDefault();
    heldAt.current = Date.now();
    setOpen({
      x: state.x,
      y: state.y,
      block: state.block,
      selection: selectionIn(state.block),
    });
  };
  const onTouchCancel = () => {
    cancel();
    allowSelect();
  };
  const onContextMenu = (e: ReactMouseEvent) => {
    // A touch hold has its own way in (Android sends this one too)
    if (touch.current || Date.now() - heldAt.current < 800) {
      e.preventDefault();
      return;
    }
    const target = e.target as Element;
    // A link or button keeps the browser's menu (Copy link address…)
    if (target.closest("a, button")) return;
    const block = target.closest<HTMLElement>(BLOCK);
    if (!block) return;
    e.preventDefault();
    setOpen({
      x: e.clientX,
      y: e.clientY,
      block,
      selection: selectionIn(block),
      mouse: true,
    });
  };

  const close = useCallback(() => setOpen(null), []);

  // A mouse-opened menu takes the focus, so it's reached by keys and read
  // out; a touch one leaves it in the box, so the keyboard stays up
  const returnTo = useRef<HTMLElement | null>(null);
  const giveBack = () => {
    returnTo.current?.focus({ preventScroll: true });
    returnTo.current = null;
  };

  // The block shows what the menu acts on
  useEffect(() => {
    const block = open?.block;
    if (!block) return;
    block.style.outline = `2px solid ${primary(0.5)}`;
    block.style.outlineOffset = "2px";
    block.style.borderRadius ||= "6px";
    return () => {
      block.style.outline = "";
      block.style.outlineOffset = "";
      if (block.style.borderRadius === "6px") block.style.borderRadius = "";
    };
  }, [open?.block]);

  // Any touch outside, a scroll, a resize or Esc puts it away
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      giveBack();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, close]);

  // Above the finger, centred on it, kept on screen: below the status strip,
  // above a docked keyboard, and on the finger's side of a fold
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!open || !el) return setPos(null);
    const { width, height } = el.getBoundingClientRect();
    const vv = window.visualViewport;
    const fold = postureStore.fold;
    let minLeft = 8;
    let maxLeft = innerWidth - width - 8;
    let minTop = (vv?.offsetTop ?? 0) + safeTop() + 8;
    let maxTop = (vv ? vv.offsetTop + vv.height : innerHeight) - height - 8;
    if (fold?.axis === "vertical") {
      if (open.x < fold.start)
        maxLeft = Math.min(maxLeft, fold.start - width - 8);
      else minLeft = Math.max(minLeft, fold.end + 8);
    } else if (fold?.axis === "horizontal") {
      if (open.y < fold.start)
        maxTop = Math.min(maxTop, fold.start - height - 8);
      else minTop = Math.max(minTop, fold.end + 8);
    }
    const left = Math.max(minLeft, Math.min(open.x - width / 2, maxLeft));
    const above = open.y - height - 16;
    const top = above >= minTop ? above : open.y + 24;
    setPos({ left, top: Math.max(minTop, Math.min(top, maxTop)) });
  }, [open]);

  useEffect(() => {
    if (!open?.mouse) return;
    const prev = document.activeElement;
    returnTo.current = prev instanceof HTMLElement ? prev : null;
    menuRef.current
      ?.querySelector<HTMLElement>("[role=menuitem]")
      ?.focus({ preventScroll: true });
  }, [open]);

  // Arrows, Home/End and Tab move along the row
  const onMenuKey = (e: ReactKeyboardEvent) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []
    );
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    let next: number | null = null;
    if (e.key in step) next = at + step[e.key];
    else if (e.key === "Tab") next = at + (e.shiftKey ? -1 : 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next === null || !items.length) return;
    e.preventDefault();
    items[(next + items.length) % items.length].focus();
  };

  const reply = () => {
    if (!open) return;
    const { block, selection } = open;
    const text = selection || block.dataset.quote || block.innerText;
    const sourceId =
      block.closest<HTMLElement>("[data-quotable]")?.dataset.sourceId;
    addQuote(sessionId, text, sourceId);
    window.getSelection()?.removeAllRanges();
    haptic("light");
    // A brief flash on what was quoted (a colour fade, no movement)
    block.animate?.(
      [{ backgroundColor: primary(0.22) }, { backgroundColor: "transparent" }],
      { duration: 900, easing: "ease-out" }
    );
    close();
    onQuoted();
  };
  const copy = () => {
    if (!open) return;
    const { block, selection } = open;
    const text =
      selection || block.querySelector("pre")?.innerText || block.innerText;
    navigator.clipboard?.writeText(text.trim()).catch(() => {});
    haptic("light");
    close();
    giveBack();
  };
  // The block selected, for the system's handles to take from there
  const select = () => {
    if (!open) return;
    const target = open.block.querySelector("pre") ?? open.block;
    close();
    window.getSelection()?.selectAllChildren(target);
  };

  const menu =
    open &&
    createPortal(
      <div
        ref={menuRef}
        role="menu"
        aria-label="Quote"
        aria-orientation="horizontal"
        onKeyDown={onMenuKey}
        className={cn(
          "bg-popover text-popover-foreground border-border fixed z-50 flex overflow-hidden rounded-xl border shadow-lg",
          !pos && "invisible"
        )}
        style={pos ?? { left: 0, top: 0 }}
      >
        {(
          [
            ["Copy", copy],
            ["Reply to this", reply],
            ["Select", select],
          ] as const
        ).map(([label, act], i) => (
          <button
            key={label}
            type="button"
            role="menuitem"
            tabIndex={-1}
            // Keeps a desktop selection, and the focus where it was
            onMouseDown={(e) => e.preventDefault()}
            onClick={act}
            className={cn(
              "active:bg-accent hover:bg-accent flex h-11 items-center px-3.5 text-[13px] whitespace-nowrap",
              i > 0 && "border-border border-l",
              label === "Reply to this" && "font-semibold"
            )}
          >
            {label}
          </button>
        ))}
      </div>,
      document.body
    );

  return {
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel,
      onContextMenu,
    },
    menu,
  };
}
