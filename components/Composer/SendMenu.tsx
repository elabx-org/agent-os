"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import type { SendChoice, SendMenuItem } from "@/lib/bg-send";
import { initialSendIndex, stepSendIndex } from "./send-menu-model";
import { usePopoverPlacement } from "./usePopoverPlacement";

export interface SendMenuProps {
  open: boolean;
  /** lib/bg-send.ts sendMenuItems */
  items: SendMenuItem[];
  /** The row shown highlighted (N-BgSend: "Send and start a new session") */
  highlighted?: SendChoice;
  onChoose: (choice: SendChoice) => void;
  onClose: () => void;
  /** The composer's card: the menu sits above it, the same width */
  anchorRef: RefObject<HTMLElement | null>;
}

/** N-BgSend's stacked square with a plus */
function StartNewIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="3" y="4" width="13" height="13" rx="3" />
      <path d="M20 9v8a3 3 0 0 1-3 3H9" />
      <path d="M9.5 8v5M7 10.5h5" />
    </svg>
  );
}

/** Three lines, the last one short: the queue */
function QueueIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

function ChoiceIcon({ choice }: { choice: SendChoice }) {
  if (choice === "sendAndNew")
    return (
      <StartNewIcon className="h-5 w-5 flex-none text-[#6D28D9] dark:text-[#C4B5FD]" />
    );
  if (choice === "queue") return <QueueIcon className="h-5 w-5 flex-none" />;
  return <ArrowUp className="h-5 w-5 flex-none" strokeWidth={2.2} />;
}

/**
 * N-BgSend's glass menu over the composer: Send / Send and start a new
 * session / Send to queue. Focus stays in the box (the keyboard stays up
 * on a phone): the arrows, Return and Esc are read while it's open, a tap
 * outside puts it away. It opens above the card (below when the card sits
 * high), never over the text.
 */
export function SendMenu({
  open,
  items,
  highlighted,
  onChoose,
  onClose,
  anchorRef,
}: SendMenuProps) {
  const shown = open && items.length > 0;
  const ref = useRef<HTMLDivElement>(null);
  const { below, maxHeight } = usePopoverPlacement(ref, shown);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);

  // Lit on opening: the highlighted row
  const firstRef = useRef(0);
  firstRef.current = initialSendIndex(items, highlighted);
  useEffect(() => {
    if (shown) setActive(firstRef.current);
  }, [shown]);

  // The anchor's width, measured each render while open (the keyboard and
  // the box growing move it)
  useLayoutEffect(() => {
    if (!shown) return;
    const parent = ref.current?.parentElement?.getBoundingClientRect();
    const anchor = anchorRef.current?.getBoundingClientRect();
    if (!parent || !anchor) return;
    const left = Math.round(anchor.left - parent.left);
    const width = Math.round(anchor.width);
    setBox((prev) =>
      prev?.left === left && prev.width === width ? prev : { left, width }
    );
  });

  const latest = useRef({ items, active, onChoose, onClose });
  latest.current = { items, active, onChoose, onClose };

  useEffect(() => {
    if (!shown) return;
    const choose = (choice: SendChoice) => {
      haptic("light");
      latest.current.onClose();
      latest.current.onChoose(choice);
    };
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) latest.current.onClose();
    };
    // Capture: ahead of the box's own Return (send) and Esc (to Claude)
    const onKey = (e: KeyboardEvent) => {
      const { items, active } = latest.current;
      if (e.key === "Escape" || e.key === "Tab") {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
        }
        latest.current.onClose();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        const item = items[active];
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        choose(item.choice);
        return;
      }
      const next = stepSendIndex(active, e.key, items.length);
      if (next === null) return;
      e.preventDefault();
      e.stopPropagation();
      setActive(next);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [shown]);

  // Focus stays in the box: the lit row is its active descendant, so a
  // screen reader names it as the arrows move
  const menuId = useId();
  const rowId = (i: number) => `${menuId}-row-${i}`;
  useEffect(() => {
    if (!shown) return;
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return;
    el.setAttribute("aria-activedescendant", `${menuId}-row-${active}`);
    el.setAttribute("aria-controls", menuId);
    return () => {
      el.removeAttribute("aria-activedescendant");
      el.removeAttribute("aria-controls");
    };
  }, [shown, active, menuId]);

  if (!shown) return null;
  const tight = maxHeight !== undefined && maxHeight < 200;

  return (
    <div
      ref={ref}
      className={cn(
        "absolute z-50",
        below ? "top-full mt-2" : "bottom-full mb-2",
        !box && "inset-x-0"
      )}
      style={box ? { left: box.left, width: box.width } : undefined}
    >
      <div
        id={menuId}
        role="menu"
        aria-label="Send options"
        className={cn(
          "glass overflow-hidden rounded-[20px] bg-[rgba(255,255,255,0.92)] dark:bg-[rgba(44,44,50,0.92)]",
          tight && "overflow-y-auto overscroll-contain"
        )}
        style={tight ? { maxHeight } : undefined}
      >
        {items.map((item, i) => (
          <button
            key={item.choice}
            id={rowId(i)}
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-choice={item.choice}
            data-active={i === active ? "" : undefined}
            // The box keeps focus, and with it the phone's keyboard
            onMouseDown={(e) => e.preventDefault()}
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse") setActive(i);
            }}
            onClick={(e) => {
              e.stopPropagation();
              haptic("light");
              onClose();
              onChoose(item.choice);
            }}
            className={cn(
              "text-foreground flex min-h-[52px] w-full touch-manipulation items-center gap-3 px-3.5 py-2 text-left text-[15px]",
              i > 0 && "border-t border-[var(--hair)]",
              i === active &&
                "bg-[rgba(124,58,237,0.12)] dark:bg-[rgba(124,58,237,0.18)]"
            )}
          >
            <ChoiceIcon choice={item.choice} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{item.label}</span>
              {item.caption && (
                <span className="text-muted-foreground truncate text-[13px]">
                  {item.caption}
                </span>
              )}
            </span>
            {item.hint && (
              <span className="text-muted-foreground flex-none rounded-md bg-[hsl(var(--foreground)/0.08)] px-1.5 py-[3px] font-mono text-[11px] whitespace-nowrap">
                {item.hint}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
