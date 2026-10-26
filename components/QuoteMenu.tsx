"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { gestures } from "@/lib/gestures";
import { addQuote } from "@/stores/replyQuotes";

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
    const block = (e.target as Element).closest<HTMLElement>(BLOCK);
    if (!block) return;
    e.preventDefault();
    setOpen({
      x: e.clientX,
      y: e.clientY,
      block,
      selection: selectionIn(block),
    });
  };

  const close = useCallback(() => setOpen(null), []);

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
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
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

  // Above the finger, centred on it, kept on screen
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!open || !el) return setPos(null);
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, open.x - width / 2),
      innerWidth - width - 8
    );
    const above = open.y - height - 16;
    setPos({ left, top: above >= 8 ? above : open.y + 24 });
  }, [open]);

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
